// SPDX-FileCopyrightText: Copyright The Thingsboard Authors
// SPDX-License-Identifier: Apache-2.0
import { Component } from '@angular/core';
import { branding } from '@shared/models/branding.constants';

@Component({
    selector: 'tb-footer',
    templateUrl: './footer.component.html',
    styleUrls: ['./footer.component.scss'],
    standalone: false
})
export class FooterComponent {

  year = new Date().getFullYear();
  companyName = branding.companyName;

}
