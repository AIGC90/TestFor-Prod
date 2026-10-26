// SPDX-FileCopyrightText: Copyright AIGC - Artificial Intelligence Global
// SPDX-License-Identifier: Apache-2.0
package org.thingsboard.server.service.security.permission;

import org.springframework.stereotype.Component;
import org.thingsboard.server.common.data.User;
import org.thingsboard.server.common.data.exception.ThingsboardErrorCode;
import org.thingsboard.server.common.data.exception.ThingsboardException;
import org.thingsboard.server.common.data.id.EntityId;
import org.thingsboard.server.common.data.security.Authority;
import org.thingsboard.server.service.security.model.SecurityUser;

import java.util.Objects;
import java.util.Optional;

/**
 * Applies {@link VisionSenseRole} restrictions on top of the authority based permission checks.
 */
@Component
public class VisionSenseRolePermissions {

    public boolean isAllowed(SecurityUser user, Resource resource, Operation operation) {
        return isAllowed(user, resource, operation, null, null);
    }

    public boolean isAllowed(SecurityUser user, Resource resource, Operation operation, EntityId entityId, Object entity) {
        if (user.getAuthority() == Authority.SYS_ADMIN) {
            return true;
        }
        Optional<VisionSenseRole> role = VisionSenseRole.fromUser(user);
        if (role.isEmpty() || role.get().isUnrestricted()) {
            return true;
        }
        if (resource == Resource.USER) {
            if (entityId != null && entityId.equals(user.getId())) {
                // Everyone can view and edit their own profile; role changes are guarded in checkCanSaveUser.
                return operation == Operation.READ || operation == Operation.WRITE;
            }
            if (entity instanceof User target && !VisionSenseRole.READ_ONLY.contains(operation)
                    && VisionSenseRole.rankOf(target) >= role.get().getRank()) {
                return false;
            }
        }
        return role.get().isAllowed(resource, operation);
    }

    /**
     * Prevents privilege escalation through the user's {@code vsRole}: only system administrators and
     * unrestricted tenant administrators may grant any role or remove one. Restricted users may only
     * assign roles ranked below their own, to users ranked below their own.
     */
    public void checkCanSaveUser(SecurityUser currentUser, User user, User existing) throws ThingsboardException {
        Optional<VisionSenseRole> newRole = VisionSenseRole.fromUser(user);
        Optional<VisionSenseRole> oldRole = VisionSenseRole.fromUser(existing);
        boolean isNew = existing == null;
        if (!isNew && Objects.equals(newRole, oldRole)) {
            return;
        }
        if (canManageAllRoles(currentUser)) {
            return;
        }
        int currentRank = VisionSenseRole.rankOf(currentUser);
        boolean allowed = newRole.isPresent() && newRole.get().getRank() < currentRank
                && (isNew || VisionSenseRole.rankOf(existing) < currentRank);
        if (!allowed) {
            throw new ThingsboardException("You don't have permission to assign this VisionSense role!",
                    ThingsboardErrorCode.PERMISSION_DENIED);
        }
    }

    public boolean canManageAllRoles(SecurityUser user) {
        if (user.getAuthority() == Authority.SYS_ADMIN) {
            return true;
        }
        return user.getAuthority() == Authority.TENANT_ADMIN
                && VisionSenseRole.fromUser(user).map(VisionSenseRole::isUnrestricted).orElse(true);
    }

}
