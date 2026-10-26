// SPDX-FileCopyrightText: Copyright AIGC - Artificial Intelligence Global
// SPDX-License-Identifier: Apache-2.0
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { AppState } from '@core/core.state';
import { getCurrentAuthUser } from '@core/auth/auth.selectors';
import { defaultHttpOptionsFromConfig, RequestConfig } from '@core/http/http-utils';
import { EntityType } from '@shared/models/entity-type.models';
import {
  isRoleOperationAllowed,
  resourceForEntityType,
  VisionSenseOperation,
  VisionSenseRoleInfo
} from '@shared/models/visionsense-role.models';

@Injectable({
  providedIn: 'root'
})
export class VisionSenseRoleService {

  private roles$: Observable<VisionSenseRoleInfo[]>;
  private rolesUserId: string;

  constructor(private http: HttpClient,
              private store: Store<AppState>) {
  }

  public getRoles(config?: RequestConfig): Observable<VisionSenseRoleInfo[]> {
    const userId = getCurrentAuthUser(this.store)?.userId;
    // "assignable" depends on the signed-in user, so cache per user.
    if (!this.roles$ || this.rolesUserId !== userId) {
      this.rolesUserId = userId;
      this.roles$ = this.http.get<VisionSenseRoleInfo[]>('/api/visionsense/roles', defaultHttpOptionsFromConfig(config)).pipe(
        shareReplay(1)
      );
    }
    return this.roles$;
  }

  public currentRole(): Observable<VisionSenseRoleInfo | undefined> {
    const roleName = getCurrentAuthUser(this.store)?.vsRole;
    return this.getRoles({ignoreLoading: true}).pipe(
      map(roles => roleName ? (roles.find(r => r.name === roleName) ?? roles.find(r => r.name === 'VIEWER')) : undefined)
    );
  }

  /** UI hint only: whether the current user's role permits the operation on the entity type. */
  public isAllowed(entityType: EntityType, operation: VisionSenseOperation): Observable<boolean> {
    return this.currentRole().pipe(
      map(role => isRoleOperationAllowed(role, resourceForEntityType(entityType), operation))
    );
  }
}
