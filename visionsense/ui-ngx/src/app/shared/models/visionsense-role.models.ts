// SPDX-FileCopyrightText: Copyright AIGC - Artificial Intelligence Global
// SPDX-License-Identifier: Apache-2.0
import { EntityType } from '@shared/models/entity-type.models';

/**
 * VisionSense construction roles. Definitions and permissions come from the server
 * (GET /api/visionsense/roles); the role itself is stored in user.additionalInfo.vsRole
 * and carried in the access token. Roles only narrow what the user's authority allows.
 */
export enum VisionSenseRole {
  COMPANY_ADMIN = 'COMPANY_ADMIN',
  PROJECT_MANAGER = 'PROJECT_MANAGER',
  SITE_ENGINEER = 'SITE_ENGINEER',
  SAFETY_OFFICER = 'SAFETY_OFFICER',
  VIEWER = 'VIEWER'
}

export const VS_ROLE_KEY = 'vsRole';

export const visionSenseRoleTitles = new Map<VisionSenseRole, string>([
  [VisionSenseRole.COMPANY_ADMIN, 'Company Admin'],
  [VisionSenseRole.PROJECT_MANAGER, 'Project Manager'],
  [VisionSenseRole.SITE_ENGINEER, 'Site Engineer'],
  [VisionSenseRole.SAFETY_OFFICER, 'Safety Officer'],
  [VisionSenseRole.VIEWER, 'Viewer']
]);

export type VisionSenseOperation = 'ALL' | 'CREATE' | 'READ' | 'WRITE' | 'DELETE' | 'ASSIGN_TO_CUSTOMER' |
  'UNASSIGN_FROM_CUSTOMER' | 'RPC_CALL' | 'READ_CREDENTIALS' | 'WRITE_CREDENTIALS' | 'READ_ATTRIBUTES' |
  'WRITE_ATTRIBUTES' | 'READ_TELEMETRY' | 'WRITE_TELEMETRY' | 'CLAIM_DEVICES' | 'ASSIGN_TO_TENANT' |
  'READ_CALCULATED_FIELD' | 'WRITE_CALCULATED_FIELD';

export interface VisionSenseRoleInfo {
  name: VisionSenseRole;
  title: string;
  description: string;
  rank: number;
  unrestricted: boolean;
  defaultOperations: VisionSenseOperation[];
  grants: {[resource: string]: VisionSenseOperation[]};
  assignable: boolean;
}

const entityTypeResources = new Map<EntityType, string>([
  [EntityType.NOTIFICATION_TARGET, 'NOTIFICATION'],
  [EntityType.NOTIFICATION_TEMPLATE, 'NOTIFICATION'],
  [EntityType.NOTIFICATION_REQUEST, 'NOTIFICATION'],
  [EntityType.NOTIFICATION_RULE, 'NOTIFICATION']
]);

export const resourceForEntityType = (entityType: EntityType): string =>
  entityTypeResources.get(entityType) ?? entityType;

/** Mirrors VisionSenseRole.isAllowed on the server; the server remains the authority. */
export const isRoleOperationAllowed = (role: VisionSenseRoleInfo | undefined, resource: string,
                                       operation: VisionSenseOperation): boolean => {
  if (!role || role.unrestricted) {
    return true;
  }
  const granted = role.grants[resource];
  if (granted && (granted.includes('ALL') || granted.includes(operation))) {
    return true;
  }
  return role.defaultOperations.includes(operation);
};
