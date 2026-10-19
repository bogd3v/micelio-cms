import {
  SEEDED,
  credit,
  documents,
  link,
  seoOf,
  type SeededImages,
} from './response-fields-seed-base';
import type { SeededArticles } from './response-fields-seed-articles';

const ABOUT_UID = 'api::about.about';
const GLOBAL_UID = 'api::global.global';
const PAGE_UID = 'api::page.page';
const SITE_SETTING_UID = 'api::site-setting.site-setting';
const SUBSCRIBER_UID = 'api::subscriber.subscriber';

/** Creates a page with every section, the About page, the global type, the site settings and a subscriber. */
export async function seedSite(
  images: SeededImages,
  articles: SeededArticles
): Promise<{ pageDocumentId: string }> {
  const { cover, avatar, metaImage, slide: sliderFile, poster, model } = images;
  const seo = seoOf(metaImage);
  const category = { documentId: articles.categoryDocumentId };
  const tag = { documentId: articles.tagDocumentId };

  const pageImage = (file: number) => file;
  const page = await documents(PAGE_UID).create({
    data: {
      title: 'Fields page',
      slug: SEEDED.pageSlug,
      seo,
      sections: [
        {
          __component: 'section.hero',
          variant: 'split',
          title: 'Hero',
          text: 'Hero text',
          primaryLink: { label: 'Go', url: '/a' },
          secondaryLink: { label: 'Other', url: '/b' },
          media: pageImage(cover),
        },
        {
          __component: 'section.feature-grid',
          variant: 'bento',
          title: 'Features',
          text: 'Feature text',
          items: [1, 2, 3].map((n) => ({ icon: avatar, title: `Feature ${n}`, text: 'Text' })),
        },
        {
          __component: 'section.media-showcase',
          variant: 'left',
          title: 'Showcase',
          text: 'Showcase **text**',
          media: cover,
          link: { label: 'Go', url: '/a' },
        },
        {
          __component: 'section.stats',
          variant: 'cards',
          title: 'Stats',
          items: [
            { value: '1', label: 'One' },
            { value: '2', label: 'Two' },
          ],
        },
        {
          __component: 'section.logo-cloud',
          variant: 'marquee',
          title: 'Logos',
          logos: [{ image: avatar, name: 'Logo', url: 'https://example.test/logo' }],
        },
        {
          __component: 'section.testimonials',
          variant: 'grid',
          title: 'Testimonials',
          items: [{ quote: 'Great', author: 'Ben', role: 'Reader', avatar }],
        },
        {
          __component: 'section.pricing',
          variant: 'table',
          title: 'Pricing',
          text: 'Pricing text',
          plans: [
            {
              name: 'Basic',
              price: '1',
              period: 'month',
              features: 'a\nb',
              link: { label: 'Buy', url: '/buy' },
              recommended: true,
            },
          ],
        },
        {
          __component: 'section.faq',
          variant: 'two-columns',
          title: 'FAQ',
          items: [{ question: 'Why?', answer: 'Because.' }],
        },
        {
          __component: 'section.cta',
          variant: 'card',
          title: 'CTA',
          text: 'CTA text',
          primaryLink: { label: 'Go', url: '/a' },
          secondaryLink: { label: 'Other', url: '/b' },
        },
        {
          __component: 'section.post-list',
          variant: 'list',
          title: 'Posts',
          category: category.documentId,
          count: 3,
        },
        {
          __component: 'section.post-list',
          variant: 'cards',
          title: 'Tagged posts',
          tag: tag.documentId,
          count: 2,
        },
        {
          __component: 'section.newsletter',
          variant: 'card',
          title: 'Newsletter',
          text: 'Join',
          buttonLabel: 'Subscribe',
        },
        { __component: 'section.rich-text', body: 'Rich **text**' },
        { __component: 'section.gallery', variant: 'masonry', title: 'Gallery', images: [cover] },
        {
          __component: 'section.scene',
          variant: 'inline',
          model,
          poster,
          alt: 'A scene',
          title: 'Scene',
          text: 'Scene text',
        },
      ],
    },
  });
  await documents(PAGE_UID).publish({ documentId: page.documentId });
  await documents(PAGE_UID).update({
    documentId: page.documentId,
    locale: 'es',
    data: { title: 'Página de campos', slug: 'pagina-de-campos' },
  });
  await documents(PAGE_UID).publish({ documentId: page.documentId, locale: 'es' });

  await documents(ABOUT_UID).create({
    data: {
      title: 'About',
      seo,
      blocks: [
        {
          __component: 'about.profile',
          eyebrow: 'Eyebrow',
          title: 'Profile',
          lead: 'Lead',
          facts: [{ label: 'Place', value: 'Here', mono: true }],
          links: [link],
          photo: avatar,
          plateLabel: 'Plate',
          plateCoordinates: '1,2',
          caption: 'Caption',
        },
        {
          __component: 'about.statement',
          eyebrow: 'Eyebrow',
          statement: 'Statement',
          body: 'Body',
        },
        {
          __component: 'about.topics',
          eyebrow: 'Eyebrow',
          title: 'Topics',
          intro: 'Intro',
          topics: [{ category: 'ia', title: 'Topic', description: 'Description' }],
          footnoteLabel: 'Note',
          footnote: 'Footnote',
        },
        {
          __component: 'about.projects',
          anchor: 'projects',
          eyebrow: 'Eyebrow',
          title: 'Projects',
          intro: 'Intro',
          projects: [
            {
              eyebrow: 'Eyebrow',
              meta: 'Meta',
              title: 'Project',
              description: 'Description',
              facts: [{ label: 'Year', value: '2026', mono: false }],
              stack: [{ name: 'Vue' }],
              links: [link],
              featured: true,
              visual: 'palette',
              visualCaption: 'Visual',
            },
          ],
        },
        {
          __component: 'about.principles',
          eyebrow: 'Eyebrow',
          title: 'Principles',
          principles: [{ title: 'One', text: 'Text' }],
        },
        {
          __component: 'about.open-source',
          eyebrow: 'Eyebrow',
          text: 'Text',
          code: 'npm i',
          guideTitle: 'Guide',
          guide: [{ title: 'Step', text: 'Text' }],
        },
        {
          __component: 'about.contact',
          eyebrow: 'Eyebrow',
          title: 'Contact',
          fediverseLabel: 'Fediverse',
          fediverseHandle: '@a@example.test',
          fediverseLink: link,
          extraLink: link,
          socials: [{ network: 'github', handle: 'ana', url: 'https://example.test/ana' }],
        },
        { __component: 'shared.rich-text', body: 'Rich' },
        { __component: 'shared.quote', title: 'Quote', body: 'Body' },
        { __component: 'shared.media', file: sliderFile, caption: 'Figure', credit },
        {
          __component: 'shared.slider',
          items: [{ file: sliderFile, caption: 'Slide', credit }],
          files: [sliderFile],
        },
      ],
    },
  });

  await documents(GLOBAL_UID).create({
    data: {
      siteName: 'Fields site',
      siteDescription: 'Description of the site',
      favicon: avatar,
      fediverseHeader: cover,
      defaultSeo: seo,
    },
  });

  const settings = await documents(SITE_SETTING_UID).findFirst();
  if (!settings) throw new Error('site-setting was not seeded on boot');
  await documents(SITE_SETTING_UID).update({
    documentId: settings.documentId,
    data: {
      name: 'Fields site',
      description: 'Description',
      tagline: 'Tagline',
      url: 'https://example.test',
      defaultLocale: 'en',
      author: { name: 'Ana Example', url: 'https://example.test/ana' },
      logo: avatar,
      favicon: avatar,
      defaultOgImage: cover,
      socialLinks: [{ network: 'github', url: 'https://example.test/gh' }],
      contactEmail: 'contact@example.test',
      privacyContactEmail: 'privacy@example.test',
      securityContact: 'mailto:security@example.test',
      privacyJurisdiction: 'colombia',
      privacyUpdatedAt: '2026-01-02T00:00:00.000Z',
      supportHandle: 'support',
      timezone: 'UTC',
      addressLocality: 'Example City',
      theme: {
        themeId: 'default',
        defaultMode: 'light',
        accentOverrides: [{ mode: 'light', color: '#336699' }],
        displayFont: 'archivo',
      },
      homePage: page.documentId,
    },
  });

  await documents(SUBSCRIBER_UID).create({
    data: {
      email: SEEDED.subscriberEmail,
      confirmationToken: 'a'.repeat(64),
      unsubscribeToken: 'b'.repeat(64),
      confirmed: true,
      language: 'en',
    },
  });

  return { pageDocumentId: page.documentId };
}
