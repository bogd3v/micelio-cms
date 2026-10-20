import type { StrapiApp } from '@strapi/strapi/admin';
import { ChartPie } from '@strapi/icons';

import {
  fediverseTranslations,
  registerFederationPanel,
  registerFediversePage,
} from '../plugins/fediverse/admin/src';

export default {
  config: {
    locales: [],
    // Strings of the federation panel (src/plugins/fediverse/admin); `es` shows once that locale is enabled above.
    translations: fediverseTranslations,
  },
  register(app: StrapiApp) {
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
