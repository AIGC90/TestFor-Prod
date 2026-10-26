// SPDX-FileCopyrightText: Copyright AIGC - Artificial Intelligence Global
// SPDX-License-Identifier: Apache-2.0
package org.thingsboard.server.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.thingsboard.server.common.data.exception.ThingsboardException;
import org.thingsboard.server.config.annotations.ApiOperation;
import org.thingsboard.server.queue.util.TbCoreComponent;
import org.thingsboard.server.service.security.model.SecurityUser;
import org.thingsboard.server.service.security.permission.Operation;
import org.thingsboard.server.service.security.permission.Resource;
import org.thingsboard.server.service.security.permission.VisionSenseRole;
import org.thingsboard.server.service.security.permission.VisionSenseRolePermissions;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

@RestController
@TbCoreComponent
@RequestMapping("/api/visionsense")
@RequiredArgsConstructor
public class VisionSenseRoleController extends BaseController {

    private final VisionSenseRolePermissions rolePermissions;

    public record RoleInfo(String name, String title, String description, int rank, boolean unrestricted,
                           Set<Operation> defaultOperations, Map<Resource, Set<Operation>> grants,
                           boolean assignable) {
    }

    @ApiOperation(value = "Get VisionSense roles (getVisionSenseRoles)",
            notes = "Returns the construction roles that can be assigned to users, their permissions, " +
                    "and whether the current user may assign each role.")
    @PreAuthorize("hasAnyAuthority('SYS_ADMIN', 'TENANT_ADMIN', 'CUSTOMER_USER')")
    @GetMapping("/roles")
    public List<RoleInfo> getRoles() throws ThingsboardException {
        SecurityUser user = getCurrentUser();
        boolean manageAll = rolePermissions.canManageAllRoles(user);
        int rank = VisionSenseRole.rankOf(user);
        return Arrays.stream(VisionSenseRole.values())
                .map(role -> new RoleInfo(role.name(), role.getTitle(), role.getDescription(), role.getRank(),
                        role.isUnrestricted(), new TreeSet<>(VisionSenseRole.READ_ONLY),
                        role.isUnrestricted() ? Map.of() : new LinkedHashMap<>(role.getGrants()),
                        manageAll || role.getRank() < rank))
                .toList();
    }

}
