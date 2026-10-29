import type { StrapiApp } from '@strapi/strapi/admin';
import { ChartPie } from '@strapi/icons';
import type { ComponentType } from 'react';

import {
  fediverseTranslations,
  registerFederationPanel,
  registerFediversePage,
} from '../plugins/fediverse/admin/src';
import en from './translations/en.json';
import es from './translations/es.json';

export default {
  config: {
    locales: [],
    // Strings of the federation panel (src/plugins/fediverse/admin); `es` shows once that locale is enabled above.
    translations: {
      en: { ...fediverseTranslations.en, ...en },
      es: { ...fediverseTranslations.es, ...es },
    },
  },
  register(app: StrapiApp) {
    // The input of site.theme.themeId (custom field global::theme-picker, registered on the server).
    app.customFields.register({
      name: 'theme-picker',
      type: 'string',
      intlLabel: { id: 'micelio.themePicker.label', defaultMessage: 'Theme' },
      intlDescription: { id: 'micelio.themePicker.description', defaultMessage: 'A theme from the registry, pinned to an exact version' },
      components: {
        Input: async () => {
          const { default: ThemePicker } = await import('./components/ThemePicker');
          // Strapi renders the input with the field's props, which ThemePicker declares.
          return { default: ThemePicker as unknown as ComponentType };
        },
      },
    });
    // The Fediverse page in the menu (docs/FEDIVERSE.md, plugin page).
    registerFediversePage(app);
    // Visitors synced from Umami (docs/ANALYTICS.md), on the admin homepage.
    app.widgets.register({
      id: 'visitors',
      icon: ChartPie,
      title: { id: 'micelio.widgets.visitors.title', defaultMessage: 'Visitors' },
      component: async () => {
        const { VisitorsWidget } = await import('./components/VisitorsWidget');
        return VisitorsWidget;
      },
    });
  },
  bootstrap(app: StrapiApp) {
    // In the side column of the article edit view (docs/FEDIVERSE.md, article panel).
    registerFederationPanel(app);
  },
};
