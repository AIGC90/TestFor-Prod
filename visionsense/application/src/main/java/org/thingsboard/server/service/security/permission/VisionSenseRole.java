// SPDX-FileCopyrightText: Copyright AIGC - Artificial Intelligence Global
// SPDX-License-Identifier: Apache-2.0
package org.thingsboard.server.service.security.permission;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.Getter;
import org.thingsboard.server.common.data.User;

import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * VisionSense construction roles.
 * <p>
 * A role is stored in the user's additional info under {@link #ADDITIONAL_INFO_KEY} and only ever
 * narrows what the user's ThingsBoard authority (TENANT_ADMIN / CUSTOMER_USER) already allows.
 * Users without a role keep the plain authority permissions, which is equivalent to {@link #COMPANY_ADMIN}.
 * <p>
 * Resources a role does not list explicitly get read-only access ({@link #READ_ONLY}), so dashboards,
 * widgets, profiles and images keep loading for every role.
 */
@Getter
public enum VisionSenseRole {

    COMPANY_ADMIN("Company Admin",
            "Full access to every site, device, dashboard, rule chain and user in the company.",
            100, null),

    PROJECT_MANAGER("Project Manager",
            "Manages sites, devices, dashboards, alarms, notifications and lower-ranked users. Cannot change rule chains, profiles or platform settings.",
            80, grants()
            .all(Resource.DEVICE, Resource.ASSET, Resource.ENTITY_VIEW, Resource.DASHBOARD, Resource.ALARM,
                    Resource.CUSTOMER, Resource.USER, Resource.EDGE, Resource.RPC, Resource.NOTIFICATION)
            .build()),

    SITE_ENGINEER("Site Engineer",
            "Installs and maintains site sensors and equipment: creates and configures devices, sends commands and handles alarms. Cannot delete devices or manage users.",
            50, grants()
            .ops(Resource.DEVICE, Operation.CREATE, Operation.WRITE, Operation.READ_CREDENTIALS, Operation.WRITE_CREDENTIALS,
                    Operation.WRITE_ATTRIBUTES, Operation.WRITE_TELEMETRY, Operation.RPC_CALL, Operation.CLAIM_DEVICES)
            .ops(Resource.ASSET, Operation.CREATE, Operation.WRITE, Operation.WRITE_ATTRIBUTES, Operation.WRITE_TELEMETRY)
            .ops(Resource.ENTITY_VIEW, Operation.WRITE_ATTRIBUTES, Operation.WRITE_TELEMETRY)
            .all(Resource.ALARM, Resource.RPC)
            .build()),

    SAFETY_OFFICER("Safety Officer",
            "Monitors safety across sites: acknowledges, clears and comments on alarms and sends safety notifications. Read-only for equipment.",
            50, grants()
            .all(Resource.ALARM, Resource.NOTIFICATION)
            .build()),

    VIEWER("Viewer",
            "Read-only access to dashboards, sites, devices and alarms.",
            10, grants().build());

    public static final String ADDITIONAL_INFO_KEY = "vsRole";

    /** Operations every role gets on every resource its authority can access. */
    public static final Set<Operation> READ_ONLY = Collections.unmodifiableSet(
            EnumSet.of(Operation.READ, Operation.READ_ATTRIBUTES, Operation.READ_TELEMETRY, Operation.READ_CALCULATED_FIELD));

    private final String title;
    private final String description;
    /** Higher rank may manage users of lower rank. Users without a role rank as {@link #COMPANY_ADMIN}. */
    private final int rank;
    /** Explicit grants on top of {@link #READ_ONLY}; {@code null} means unrestricted. */
    private final Map<Resource, Set<Operation>> grants;

    VisionSenseRole(String title, String description, int rank, Map<Resource, Set<Operation>> grants) {
        this.title = title;
        this.description = description;
        this.rank = rank;
        this.grants = grants;
    }

    public boolean isUnrestricted() {
        return grants == null;
    }

    public boolean isAllowed(Resource resource, Operation operation) {
        if (grants == null) {
            return true;
        }
        Set<Operation> granted = grants.get(resource);
        if (granted != null && (granted.contains(Operation.ALL) || granted.contains(operation))) {
            return true;
        }
        return READ_ONLY.contains(operation);
    }

    /**
     * Returns the role stored on the user, or empty when none is set.
     * An unknown value maps to {@link #VIEWER} so a corrupted role never widens access.
     */
    public static Optional<VisionSenseRole> fromUser(User user) {
        if (user == null) {
            return Optional.empty();
        }
        return fromAdditionalInfo(user.getAdditionalInfo());
    }

    public static Optional<VisionSenseRole> fromAdditionalInfo(JsonNode additionalInfo) {
        if (additionalInfo == null || !additionalInfo.hasNonNull(ADDITIONAL_INFO_KEY)) {
            return Optional.empty();
        }
        return Optional.of(parse(additionalInfo.get(ADDITIONAL_INFO_KEY).asText()));
    }

    public static VisionSenseRole parse(String value) {
        try {
            return VisionSenseRole.valueOf(value);
        } catch (IllegalArgumentException | NullPointerException e) {
            return VIEWER;
        }
    }

    /** Rank of a user, treating users without a role as company admins. */
    public static int rankOf(User user) {
        return fromUser(user).map(VisionSenseRole::getRank).orElse(COMPANY_ADMIN.rank);
    }

    private static GrantsBuilder grants() {
        return new GrantsBuilder();
    }

    private static class GrantsBuilder {
        private final Map<Resource, Set<Operation>> grants = new EnumMap<>(Resource.class);

        GrantsBuilder all(Resource... resources) {
            for (Resource resource : resources) {
                grants.put(resource, EnumSet.of(Operation.ALL));
            }
            return this;
        }

        GrantsBuilder ops(Resource resource, Operation first, Operation... rest) {
            grants.put(resource, EnumSet.of(first, rest));
            return this;
        }

        Map<Resource, Set<Operation>> build() {
            return Collections.unmodifiableMap(grants);
        }
    }

}
