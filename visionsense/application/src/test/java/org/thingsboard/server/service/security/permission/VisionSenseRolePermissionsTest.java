// SPDX-FileCopyrightText: Copyright AIGC - Artificial Intelligence Global
// SPDX-License-Identifier: Apache-2.0
package org.thingsboard.server.service.security.permission;

import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.thingsboard.common.util.JacksonUtil;
import org.thingsboard.server.common.data.User;
import org.thingsboard.server.common.data.exception.ThingsboardException;
import org.thingsboard.server.common.data.id.DeviceId;
import org.thingsboard.server.common.data.id.TenantId;
import org.thingsboard.server.common.data.id.UserId;
import org.thingsboard.server.common.data.security.Authority;
import org.thingsboard.server.service.security.model.SecurityUser;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

public class VisionSenseRolePermissionsTest {

    private final VisionSenseRolePermissions permissions = new VisionSenseRolePermissions();
    private final TenantId tenantId = TenantId.fromUUID(UUID.randomUUID());

    @Test
    public void usersWithoutRoleAreUnrestricted() {
        SecurityUser admin = securityUser(Authority.TENANT_ADMIN, null);
        assertThat(permissions.isAllowed(admin, Resource.RULE_CHAIN, Operation.DELETE)).isTrue();
        assertThat(permissions.canManageAllRoles(admin)).isTrue();
    }

    @Test
    public void viewerIsReadOnly() {
        SecurityUser viewer = securityUser(Authority.TENANT_ADMIN, VisionSenseRole.VIEWER);
        assertThat(permissions.isAllowed(viewer, Resource.DEVICE, Operation.READ)).isTrue();
        assertThat(permissions.isAllowed(viewer, Resource.DEVICE, Operation.READ_TELEMETRY)).isTrue();
        assertThat(permissions.isAllowed(viewer, Resource.DEVICE, Operation.WRITE)).isFalse();
        assertThat(permissions.isAllowed(viewer, Resource.DEVICE, Operation.READ_CREDENTIALS)).isFalse();
        assertThat(permissions.isAllowed(viewer, Resource.ALARM, Operation.WRITE)).isFalse();
        assertThat(permissions.isAllowed(viewer, Resource.DASHBOARD, Operation.CREATE)).isFalse();
    }

    @Test
    public void siteEngineerManagesDevicesButCannotDeleteThem() {
        SecurityUser engineer = securityUser(Authority.TENANT_ADMIN, VisionSenseRole.SITE_ENGINEER);
        DeviceId deviceId = new DeviceId(UUID.randomUUID());
        assertThat(permissions.isAllowed(engineer, Resource.DEVICE, Operation.CREATE)).isTrue();
        assertThat(permissions.isAllowed(engineer, Resource.DEVICE, Operation.RPC_CALL, deviceId, null)).isTrue();
        assertThat(permissions.isAllowed(engineer, Resource.DEVICE, Operation.DELETE, deviceId, null)).isFalse();
        assertThat(permissions.isAllowed(engineer, Resource.ALARM, Operation.WRITE)).isTrue();
        assertThat(permissions.isAllowed(engineer, Resource.USER, Operation.CREATE)).isFalse();
        assertThat(permissions.isAllowed(engineer, Resource.RULE_CHAIN, Operation.WRITE)).isFalse();
    }

    @Test
    public void safetyOfficerHandlesAlarmsAndNotifications() {
        SecurityUser officer = securityUser(Authority.CUSTOMER_USER, VisionSenseRole.SAFETY_OFFICER);
        assertThat(permissions.isAllowed(officer, Resource.ALARM, Operation.WRITE)).isTrue();
        assertThat(permissions.isAllowed(officer, Resource.NOTIFICATION, Operation.CREATE)).isTrue();
        assertThat(permissions.isAllowed(officer, Resource.DEVICE, Operation.RPC_CALL)).isFalse();
        assertThat(permissions.isAllowed(officer, Resource.DEVICE, Operation.WRITE_ATTRIBUTES)).isFalse();
    }

    @Test
    public void projectManagerCannotModifyUsersOfEqualOrHigherRank() {
        SecurityUser manager = securityUser(Authority.TENANT_ADMIN, VisionSenseRole.PROJECT_MANAGER);
        User companyAdmin = user(Authority.TENANT_ADMIN, null);
        User peer = user(Authority.TENANT_ADMIN, VisionSenseRole.PROJECT_MANAGER);
        User engineer = user(Authority.CUSTOMER_USER, VisionSenseRole.SITE_ENGINEER);

        assertThat(permissions.isAllowed(manager, Resource.USER, Operation.READ, companyAdmin.getId(), companyAdmin)).isTrue();
        assertThat(permissions.isAllowed(manager, Resource.USER, Operation.WRITE, companyAdmin.getId(), companyAdmin)).isFalse();
        assertThat(permissions.isAllowed(manager, Resource.USER, Operation.DELETE, peer.getId(), peer)).isFalse();
        assertThat(permissions.isAllowed(manager, Resource.USER, Operation.WRITE, engineer.getId(), engineer)).isTrue();
        // Creating a user without a role would create an unrestricted user.
        assertThat(permissions.isAllowed(manager, Resource.USER, Operation.CREATE, null, user(Authority.TENANT_ADMIN, null))).isFalse();
    }

    @Test
    public void restrictedUsersCanEditOwnProfile() {
        SecurityUser viewer = securityUser(Authority.TENANT_ADMIN, VisionSenseRole.VIEWER);
        assertThat(permissions.isAllowed(viewer, Resource.USER, Operation.WRITE, viewer.getId(), viewer)).isTrue();
        assertThat(permissions.isAllowed(viewer, Resource.USER, Operation.DELETE, viewer.getId(), viewer)).isFalse();
    }

    @Test
    public void restrictedUsersCannotChangeOwnRole() {
        SecurityUser manager = securityUser(Authority.TENANT_ADMIN, VisionSenseRole.PROJECT_MANAGER);
        User existing = new User(manager);
        User promoted = new User(manager);
        promoted.setAdditionalInfo(roleInfo(VisionSenseRole.COMPANY_ADMIN));
        User roleRemoved = new User(manager);
        roleRemoved.setAdditionalInfo(JacksonUtil.newObjectNode());

        assertThatCode(() -> permissions.checkCanSaveUser(manager, new User(manager), existing)).doesNotThrowAnyException();
        assertThatThrownBy(() -> permissions.checkCanSaveUser(manager, promoted, existing)).isInstanceOf(ThingsboardException.class);
        assertThatThrownBy(() -> permissions.checkCanSaveUser(manager, roleRemoved, existing)).isInstanceOf(ThingsboardException.class);
    }

    @Test
    public void projectManagerCanOnlyAssignLowerRoles() {
        SecurityUser manager = securityUser(Authority.TENANT_ADMIN, VisionSenseRole.PROJECT_MANAGER);
        User engineer = user(Authority.CUSTOMER_USER, VisionSenseRole.SITE_ENGINEER);
        User toViewer = new User(engineer);
        toViewer.setAdditionalInfo(roleInfo(VisionSenseRole.VIEWER));
        User toManager = new User(engineer);
        toManager.setAdditionalInfo(roleInfo(VisionSenseRole.PROJECT_MANAGER));

        assertThatCode(() -> permissions.checkCanSaveUser(manager, toViewer, engineer)).doesNotThrowAnyException();
        assertThatThrownBy(() -> permissions.checkCanSaveUser(manager, toManager, engineer)).isInstanceOf(ThingsboardException.class);
        assertThatCode(() -> permissions.checkCanSaveUser(manager, user(Authority.CUSTOMER_USER, VisionSenseRole.SAFETY_OFFICER), null))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> permissions.checkCanSaveUser(manager, user(Authority.CUSTOMER_USER, null), null))
                .isInstanceOf(ThingsboardException.class);
    }

    @Test
    public void companyAdminCanAssignAnyRole() {
        SecurityUser companyAdmin = securityUser(Authority.TENANT_ADMIN, VisionSenseRole.COMPANY_ADMIN);
        User manager = user(Authority.TENANT_ADMIN, VisionSenseRole.PROJECT_MANAGER);
        User unrestricted = new User(manager);
        unrestricted.setAdditionalInfo(JacksonUtil.newObjectNode());

        assertThat(permissions.canManageAllRoles(companyAdmin)).isTrue();
        assertThatCode(() -> permissions.checkCanSaveUser(companyAdmin, unrestricted, manager)).doesNotThrowAnyException();
    }

    @Test
    public void customerUserWithoutRoleCannotGrantRoles() {
        SecurityUser customerUser = securityUser(Authority.CUSTOMER_USER, null);
        User self = new User(customerUser);
        User promoted = new User(customerUser);
        promoted.setAdditionalInfo(roleInfo(VisionSenseRole.COMPANY_ADMIN));

        assertThat(permissions.canManageAllRoles(customerUser)).isFalse();
        assertThatThrownBy(() -> permissions.checkCanSaveUser(customerUser, promoted, self)).isInstanceOf(ThingsboardException.class);
    }

    @Test
    public void unknownRoleFallsBackToViewer() {
        assertThat(VisionSenseRole.parse("SUPER_USER")).isEqualTo(VisionSenseRole.VIEWER);
        SecurityUser user = securityUser(Authority.TENANT_ADMIN, null);
        user.setAdditionalInfo(JacksonUtil.newObjectNode().put(VisionSenseRole.ADDITIONAL_INFO_KEY, "SUPER_USER"));
        assertThat(permissions.isAllowed(user, Resource.DEVICE, Operation.WRITE)).isFalse();
    }

    @Test
    public void sysAdminIsNeverRestricted() {
        SecurityUser sysAdmin = securityUser(Authority.SYS_ADMIN, VisionSenseRole.VIEWER);
        assertThat(permissions.isAllowed(sysAdmin, Resource.TENANT, Operation.DELETE)).isTrue();
        assertThat(permissions.canManageAllRoles(sysAdmin)).isTrue();
    }

    private SecurityUser securityUser(Authority authority, VisionSenseRole role) {
        SecurityUser user = new SecurityUser(new UserId(UUID.randomUUID()));
        user.setTenantId(tenantId);
        user.setAuthority(authority);
        user.setAdditionalInfo(roleInfo(role));
        return user;
    }

    private User user(Authority authority, VisionSenseRole role) {
        User user = new User(new UserId(UUID.randomUUID()));
        user.setTenantId(tenantId);
        user.setAuthority(authority);
        user.setAdditionalInfo(roleInfo(role));
        return user;
    }

    private static ObjectNode roleInfo(VisionSenseRole role) {
        var info = JacksonUtil.newObjectNode();
        if (role != null) {
            info.put(VisionSenseRole.ADDITIONAL_INFO_KEY, role.name());
        }
        return info;
    }

}
