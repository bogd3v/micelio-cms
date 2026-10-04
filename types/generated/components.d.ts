import type { Schema, Struct } from '@strapi/strapi';

export interface AboutContact extends Struct.ComponentSchema {
  collectionName: 'components_about_contacts';
  info: {
    description: 'Contact block with the fediverse account, an extra link and social profiles';
    displayName: 'Contact';
    icon: 'paperPlane';
  };
  attributes: {
    extraLink: Schema.Attribute.Component<'about.link', false>;
    eyebrow: Schema.Attribute.String;
    fediverseHandle: Schema.Attribute.String;
    fediverseLabel: Schema.Attribute.String;
    fediverseLink: Schema.Attribute.Component<'about.link', false>;
    socials: Schema.Attribute.Component<'about.contact-link', true>;
    title: Schema.Attribute.String;
  };
}

export interface AboutContactLink extends Struct.ComponentSchema {
  collectionName: 'components_about_contact_links';
  info: {
    description: 'A social profile shown in the contact list';
    displayName: 'Contact link';
    icon: 'message';
  };
  attributes: {
    handle: Schema.Attribute.String & Schema.Attribute.Required;
    network: Schema.Attribute.String & Schema.Attribute.Required;
    url: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface AboutFact extends Struct.ComponentSchema {
  collectionName: 'components_about_facts';
  info: {
    description: 'A label and value pair for a field-guide style list';
    displayName: 'Fact';
    icon: 'bulletList';
  };
  attributes: {
    label: Schema.Attribute.String & Schema.Attribute.Required;
    mono: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    value: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface AboutItem extends Struct.ComponentSchema {
  collectionName: 'components_about_items';
  info: {
    description: 'A short item with an optional title; the text supports inline Markdown links';
    displayName: 'Item';
    icon: 'feather';
  };
  attributes: {
    text: Schema.Attribute.Text & Schema.Attribute.Required;
    title: Schema.Attribute.String;
  };
}

export interface AboutLink extends Struct.ComponentSchema {
  collectionName: 'components_about_links';
  info: {
    description: 'A labelled link with a button style';
    displayName: 'Link';
    icon: 'link';
  };
  attributes: {
    label: Schema.Attribute.String & Schema.Attribute.Required;
    url: Schema.Attribute.String & Schema.Attribute.Required;
    variant: Schema.Attribute.Enumeration<['primary', 'secondary', 'text']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'text'>;
  };
}

export interface AboutOpenSource extends Struct.ComponentSchema {
  collectionName: 'components_about_open_sources';
  info: {
    description: 'Open source note with a code snippet and a short guide';
    displayName: 'Open source';
    icon: 'github';
  };
  attributes: {
    code: Schema.Attribute.Text;
    eyebrow: Schema.Attribute.String;
    guide: Schema.Attribute.Component<'about.item', true>;
    guideTitle: Schema.Attribute.String;
    text: Schema.Attribute.Text;
  };
}

export interface AboutPrinciples extends Struct.ComponentSchema {
  collectionName: 'components_about_principle_lists';
  info: {
    description: 'Numbered list of principles';
    displayName: 'Principles';
    icon: 'check';
  };
  attributes: {
    eyebrow: Schema.Attribute.String;
    principles: Schema.Attribute.Component<'about.item', true>;
    title: Schema.Attribute.String;
  };
}

export interface AboutProfile extends Struct.ComponentSchema {
  collectionName: 'components_about_profiles';
  info: {
    description: 'Field card: greeting, key facts, calls to action and the plate with a photo';
    displayName: 'Profile';
    icon: 'user';
  };
  attributes: {
    caption: Schema.Attribute.String;
    eyebrow: Schema.Attribute.String;
    facts: Schema.Attribute.Component<'about.fact', true>;
    lead: Schema.Attribute.Text;
    links: Schema.Attribute.Component<'about.link', true>;
    photo: Schema.Attribute.Media<'images'>;
    plateCoordinates: Schema.Attribute.String;
    plateLabel: Schema.Attribute.String;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface AboutProject extends Struct.ComponentSchema {
  collectionName: 'components_about_projects';
  info: {
    description: 'A project card; the featured one gets the large layout';
    displayName: 'Project';
    icon: 'code';
  };
  attributes: {
    description: Schema.Attribute.Text;
    eyebrow: Schema.Attribute.String;
    facts: Schema.Attribute.Component<'about.fact', true>;
    featured: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    links: Schema.Attribute.Component<'about.link', true>;
    meta: Schema.Attribute.String;
    stack: Schema.Attribute.Component<'shared.tech-item', true>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    visual: Schema.Attribute.Enumeration<['none', 'fediverse', 'palette']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'none'>;
    visualCaption: Schema.Attribute.String;
  };
}

export interface AboutProjects extends Struct.ComponentSchema {
  collectionName: 'components_about_project_lists';
  info: {
    description: 'Project list with one featured project';
    displayName: 'Projects';
    icon: 'briefcase';
  };
  attributes: {
    anchor: Schema.Attribute.String;
    eyebrow: Schema.Attribute.String;
    intro: Schema.Attribute.Text;
    projects: Schema.Attribute.Component<'about.project', true>;
    title: Schema.Attribute.String;
  };
}

export interface AboutStatement extends Struct.ComponentSchema {
  collectionName: 'components_about_statements';
  info: {
    description: 'A large statement with supporting text';
    displayName: 'Statement';
    icon: 'quote';
  };
  attributes: {
    body: Schema.Attribute.Text;
    eyebrow: Schema.Attribute.String;
    statement: Schema.Attribute.Text & Schema.Attribute.Required;
  };
}

export interface AboutTopic extends Struct.ComponentSchema {
  collectionName: 'components_about_topics';
  info: {
    description: 'One of the five blog topics with its own description';
    displayName: 'Topic';
    icon: 'layer';
  };
  attributes: {
    category: Schema.Attribute.Enumeration<['privacidad', 'diy', 'ia', 'software', 'linux']> &
      Schema.Attribute.Required;
    description: Schema.Attribute.Text;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface AboutTopics extends Struct.ComponentSchema {
  collectionName: 'components_about_topic_lists';
  info: {
    description: 'The five blog topics with a short description each';
    displayName: 'Topics';
    icon: 'grid';
  };
  attributes: {
    eyebrow: Schema.Attribute.String;
    footnote: Schema.Attribute.String;
    footnoteLabel: Schema.Attribute.String;
    intro: Schema.Attribute.Text;
    title: Schema.Attribute.String;
    topics: Schema.Attribute.Component<'about.topic', true>;
  };
}

export interface SectionCta extends Struct.ComponentSchema {
  collectionName: 'components_section_ctas';
  info: {
    description: 'A call to action';
    displayName: 'Call to action';
    icon: 'rocket';
  };
  attributes: {
    primaryLink: Schema.Attribute.Component<'section.link', false>;
    secondaryLink: Schema.Attribute.Component<'section.link', false>;
    text: Schema.Attribute.Text;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    variant: Schema.Attribute.Enumeration<['banner', 'card']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'banner'>;
  };
}

export interface SectionFaq extends Struct.ComponentSchema {
  collectionName: 'components_section_faqs';
  info: {
    description: 'Questions and answers, rendered with native <details>';
    displayName: 'FAQ';
    icon: 'question';
  };
  attributes: {
    items: Schema.Attribute.Component<'section.faq-item', true> &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    title: Schema.Attribute.String;
    variant: Schema.Attribute.Enumeration<['list', 'two-columns']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'list'>;
  };
}

export interface SectionFaqItem extends Struct.ComponentSchema {
  collectionName: 'components_section_faq_items';
  info: {
    description: 'A question and its answer';
    displayName: 'Question';
    icon: 'question';
  };
  attributes: {
    answer: Schema.Attribute.RichText & Schema.Attribute.Required;
    question: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SectionFeatureGrid extends Struct.ComponentSchema {
  collectionName: 'components_section_feature_grids';
  info: {
    description: 'Three to six features with icon, title and text';
    displayName: 'Feature grid';
    icon: 'grid';
  };
  attributes: {
    items: Schema.Attribute.Component<'section.feature-item', true> &
      Schema.Attribute.SetMinMax<
        {
          max: 6;
          min: 3;
        },
        number
      >;
    text: Schema.Attribute.Text;
    title: Schema.Attribute.String;
    variant: Schema.Attribute.Enumeration<['grid', 'list', 'bento']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'grid'>;
  };
}

export interface SectionFeatureItem extends Struct.ComponentSchema {
  collectionName: 'components_section_feature_items';
  info: {
    description: 'One feature of a feature grid';
    displayName: 'Feature';
    icon: 'star';
  };
  attributes: {
    icon: Schema.Attribute.Media<'images'>;
    text: Schema.Attribute.Text;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SectionGallery extends Struct.ComponentSchema {
  collectionName: 'components_section_galleries';
  info: {
    description: "Images with their captions (each file's caption)";
    displayName: 'Gallery';
    icon: 'images';
  };
  attributes: {
    images: Schema.Attribute.Media<'images', true> & Schema.Attribute.Required;
    title: Schema.Attribute.String;
    variant: Schema.Attribute.Enumeration<['grid', 'masonry']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'grid'>;
  };
}

export interface SectionHero extends Struct.ComponentSchema {
  collectionName: 'components_section_heroes';
  info: {
    description: 'Opening section: title, text, calls to action and media';
    displayName: 'Hero';
    icon: 'landscape';
  };
  attributes: {
    media: Schema.Attribute.Media<'images' | 'videos'>;
    primaryLink: Schema.Attribute.Component<'section.link', false>;
    secondaryLink: Schema.Attribute.Component<'section.link', false>;
    text: Schema.Attribute.Text;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    variant: Schema.Attribute.Enumeration<['centered', 'split', 'full-bleed']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'centered'>;
  };
}

export interface SectionLink extends Struct.ComponentSchema {
  collectionName: 'components_section_links';
  info: {
    description: 'A labeled link: http(s), mailto: or a path on the site';
    displayName: 'Link';
    icon: 'link';
  };
  attributes: {
    label: Schema.Attribute.String & Schema.Attribute.Required;
    url: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SectionLogo extends Struct.ComponentSchema {
  collectionName: 'components_section_logos';
  info: {
    description: 'A logo with its name and an optional link';
    displayName: 'Logo';
    icon: 'picture';
  };
  attributes: {
    image: Schema.Attribute.Media<'images'> & Schema.Attribute.Required;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    url: Schema.Attribute.String;
  };
}

export interface SectionLogoCloud extends Struct.ComponentSchema {
  collectionName: 'components_section_logo_clouds';
  info: {
    description: 'Logos with links';
    displayName: 'Logo cloud';
    icon: 'apps';
  };
  attributes: {
    logos: Schema.Attribute.Component<'section.logo', true> &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    title: Schema.Attribute.String;
    variant: Schema.Attribute.Enumeration<['row', 'marquee']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'row'>;
  };
}

export interface SectionMediaShowcase extends Struct.ComponentSchema {
  collectionName: 'components_section_media_showcases';
  info: {
    description: 'An image or video with text';
    displayName: 'Media showcase';
    icon: 'picture';
  };
  attributes: {
    link: Schema.Attribute.Component<'section.link', false>;
    media: Schema.Attribute.Media<'images' | 'videos'> & Schema.Attribute.Required;
    text: Schema.Attribute.RichText;
    title: Schema.Attribute.String;
    variant: Schema.Attribute.Enumeration<['left', 'right', 'stacked']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'left'>;
  };
}

export interface SectionNewsletter extends Struct.ComponentSchema {
  collectionName: 'components_section_newsletters';
  info: {
    description: 'Subscription form; where it posts is set in the frontend';
    displayName: 'Newsletter';
    icon: 'message';
  };
  attributes: {
    buttonLabel: Schema.Attribute.String;
    text: Schema.Attribute.Text;
    title: Schema.Attribute.String;
    variant: Schema.Attribute.Enumeration<['inline', 'card']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'inline'>;
  };
}

export interface SectionPlan extends Struct.ComponentSchema {
  collectionName: 'components_section_plans';
  info: {
    description: 'A pricing plan';
    displayName: 'Plan';
    icon: 'priceTag';
  };
  attributes: {
    features: Schema.Attribute.Text;
    link: Schema.Attribute.Component<'section.link', false>;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    period: Schema.Attribute.String;
    price: Schema.Attribute.String & Schema.Attribute.Required;
    recommended: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
  };
}

export interface SectionPostList extends Struct.ComponentSchema {
  collectionName: 'components_section_post_lists';
  info: {
    description: 'Latest articles, of a category or a tag';
    displayName: 'Post list';
    icon: 'bulletList';
  };
  attributes: {
    category: Schema.Attribute.Relation<'oneToOne', 'api::category.category'>;
    count: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 12;
          min: 1;
        },
        number
      > &
      Schema.Attribute.DefaultTo<3>;
    tag: Schema.Attribute.Relation<'oneToOne', 'api::tag.tag'>;
    title: Schema.Attribute.String;
    variant: Schema.Attribute.Enumeration<['cards', 'list']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'cards'>;
  };
}

export interface SectionPricing extends Struct.ComponentSchema {
  collectionName: 'components_section_pricings';
  info: {
    description: 'Plans with price and features';
    displayName: 'Pricing';
    icon: 'priceTag';
  };
  attributes: {
    plans: Schema.Attribute.Component<'section.plan', true> &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    text: Schema.Attribute.Text;
    title: Schema.Attribute.String;
    variant: Schema.Attribute.Enumeration<['cards', 'table']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'cards'>;
  };
}

export interface SectionRichText extends Struct.ComponentSchema {
  collectionName: 'components_section_rich_texts';
  info: {
    description: 'Long text in Markdown';
    displayName: 'Rich text';
    icon: 'feather';
  };
  attributes: {
    body: Schema.Attribute.RichText & Schema.Attribute.Required;
  };
}

export interface SectionScene extends Struct.ComponentSchema {
  collectionName: 'components_section_scenes';
  info: {
    description: '3D scene (heavy island): a glTF model with a required poster and alt text';
    displayName: 'Scene';
    icon: 'globe';
  };
  attributes: {
    alt: Schema.Attribute.String & Schema.Attribute.Required;
    model: Schema.Attribute.Media<'files'> & Schema.Attribute.Required;
    poster: Schema.Attribute.Media<'images'> & Schema.Attribute.Required;
    text: Schema.Attribute.Text;
    title: Schema.Attribute.String;
    variant: Schema.Attribute.Enumeration<['background', 'inline']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'background'>;
  };
}

export interface SectionStat extends Struct.ComponentSchema {
  collectionName: 'components_section_stat_items';
  info: {
    description: 'A figure with its label';
    displayName: 'Stat';
    icon: 'chartPie';
  };
  attributes: {
    label: Schema.Attribute.String & Schema.Attribute.Required;
    value: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SectionStats extends Struct.ComponentSchema {
  collectionName: 'components_section_stats';
  info: {
    description: 'Two to four figures with their labels';
    displayName: 'Stats';
    icon: 'chartBubble';
  };
  attributes: {
    items: Schema.Attribute.Component<'section.stat', true> &
      Schema.Attribute.SetMinMax<
        {
          max: 4;
          min: 2;
        },
        number
      >;
    title: Schema.Attribute.String;
    variant: Schema.Attribute.Enumeration<['row', 'cards']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'row'>;
  };
}

export interface SectionTestimonial extends Struct.ComponentSchema {
  collectionName: 'components_section_testimonial_items';
  info: {
    description: 'A quote and who said it';
    displayName: 'Testimonial';
    icon: 'quote';
  };
  attributes: {
    author: Schema.Attribute.String & Schema.Attribute.Required;
    avatar: Schema.Attribute.Media<'images'>;
    quote: Schema.Attribute.Text & Schema.Attribute.Required;
    role: Schema.Attribute.String;
  };
}

export interface SectionTestimonials extends Struct.ComponentSchema {
  collectionName: 'components_section_testimonials';
  info: {
    description: 'Quotes with their authors';
    displayName: 'Testimonials';
    icon: 'discuss';
  };
  attributes: {
    items: Schema.Attribute.Component<'section.testimonial', true> &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    title: Schema.Attribute.String;
    variant: Schema.Attribute.Enumeration<['single', 'grid']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'single'>;
  };
}

export interface SharedImageCredit extends Struct.ComponentSchema {
  collectionName: 'components_shared_image_credits';
  info: {
    description: 'Who made an image, where it comes from and under which license';
    displayName: 'Image credit';
    icon: 'picture';
  };
  attributes: {
    author: Schema.Attribute.String;
    authorUrl: Schema.Attribute.String;
    kind: Schema.Attribute.Enumeration<['photo', 'illustration', 'diagram', 'screenshot']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'photo'>;
    license: Schema.Attribute.Enumeration<
      [
        'own-work',
        'cc0',
        'public-domain',
        'cc-by-4.0',
        'cc-by-sa-4.0',
        'cc-by-nc-4.0',
        'unsplash',
        'permission',
        'other',
      ]
    > &
      Schema.Attribute.Required;
    licenseUrl: Schema.Attribute.String;
    modifications: Schema.Attribute.String;
    source: Schema.Attribute.String;
    sourceUrl: Schema.Attribute.String;
  };
}

export interface SharedMedia extends Struct.ComponentSchema {
  collectionName: 'components_shared_media';
  info: {
    displayName: 'Media';
    icon: 'file-video';
  };
  attributes: {
    caption: Schema.Attribute.Text;
    credit: Schema.Attribute.Component<'shared.image-credit', false>;
    file: Schema.Attribute.Media<'images' | 'files' | 'videos'>;
  };
}

export interface SharedMetaSocial extends Struct.ComponentSchema {
  collectionName: 'components_shared_meta_socials';
  info: {
    description: '';
    displayName: 'metaSocial';
    icon: 'project-diagram';
  };
  attributes: {
    description: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 200;
      }>;
    image: Schema.Attribute.Media<'images' | 'files' | 'videos'>;
    socialNetwork: Schema.Attribute.Enumeration<['Facebook', 'Twitter']> &
      Schema.Attribute.Required;
    title: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 70;
      }>;
  };
}

export interface SharedQuote extends Struct.ComponentSchema {
  collectionName: 'components_shared_quotes';
  info: {
    displayName: 'Quote';
    icon: 'indent';
  };
  attributes: {
    body: Schema.Attribute.Text;
    title: Schema.Attribute.String;
  };
}

export interface SharedReference extends Struct.ComponentSchema {
  collectionName: 'components_shared_references';
  info: {
    description: 'A bibliographic source, cited in the body as [@key]';
    displayName: 'Reference';
    icon: 'book';
  };
  attributes: {
    accessedAt: Schema.Attribute.Date;
    authors: Schema.Attribute.Text & Schema.Attribute.Required;
    container: Schema.Attribute.String;
    doi: Schema.Attribute.String;
    issue: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 32;
      }>;
    key: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 64;
      }>;
    pages: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 32;
      }>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    type: Schema.Attribute.Enumeration<
      ['journal', 'conference', 'preprint', 'book', 'chapter', 'web', 'software', 'docs']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'journal'>;
    url: Schema.Attribute.String;
    venueLabel: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 80;
      }>;
    volume: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 32;
      }>;
    year: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 16;
      }>;
  };
}

export interface SharedRichText extends Struct.ComponentSchema {
  collectionName: 'components_shared_rich_texts';
  info: {
    description: '';
    displayName: 'Rich text';
    icon: 'align-justify';
  };
  attributes: {
    body: Schema.Attribute.RichText;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    description: '';
    displayName: 'seo';
    icon: 'search';
  };
  attributes: {
    canonicalURL: Schema.Attribute.String;
    keywords: Schema.Attribute.Text;
    metaDescription: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
        minLength: 50;
      }>;
    metaImage: Schema.Attribute.Media<'images' | 'files' | 'videos'> & Schema.Attribute.Required;
    metaRobots: Schema.Attribute.String;
    metaSocial: Schema.Attribute.Component<'shared.meta-social', true>;
    metaTitle: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 60;
      }>;
    metaViewport: Schema.Attribute.String;
    structuredData: Schema.Attribute.JSON;
  };
}

export interface SharedSlide extends Struct.ComponentSchema {
  collectionName: 'components_shared_slides';
  info: {
    description: 'One image of a slider, with its own caption and credit';
    displayName: 'Slide';
    icon: 'picture';
  };
  attributes: {
    caption: Schema.Attribute.Text;
    credit: Schema.Attribute.Component<'shared.image-credit', false>;
    file: Schema.Attribute.Media<'images'> & Schema.Attribute.Required;
  };
}

export interface SharedSlider extends Struct.ComponentSchema {
  collectionName: 'components_shared_sliders';
  info: {
    description: '';
    displayName: 'Slider';
    icon: 'address-book';
  };
  attributes: {
    files: Schema.Attribute.Media<'images', true>;
    items: Schema.Attribute.Component<'shared.slide', true>;
  };
}

export interface SharedTechItem extends Struct.ComponentSchema {
  collectionName: 'components_shared_tech_items';
  info: {
    description: 'A single technology name';
    displayName: 'Tech Item';
    icon: 'tag';
  };
  attributes: {
    name: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SiteAccentOverride extends Struct.ComponentSchema {
  collectionName: 'components_site_accent_overrides';
  info: {
    description: "Accent color for one of the theme's modes. The frontend adjusts it if it fails contrast";
    displayName: 'Accent override';
    icon: 'paint';
  };
  attributes: {
    color: Schema.Attribute.String & Schema.Attribute.Required;
    mode: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SiteAuthor extends Struct.ComponentSchema {
  collectionName: 'components_site_authors';
  info: {
    description: 'Who writes the site';
    displayName: 'Author';
    icon: 'user';
  };
  attributes: {
    name: Schema.Attribute.String & Schema.Attribute.Required;
    url: Schema.Attribute.String;
  };
}

export interface SiteModules extends Struct.ComponentSchema {
  collectionName: 'components_site_modules';
  info: {
    description: 'Features the frontend turns on. All of them are on unless turned off here';
    displayName: 'Modules';
    icon: 'puzzle';
  };
  attributes: {
    accounts: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    comments: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    drafts: Schema.Attribute.Boolean & Schema.Attribute.Required & Schema.Attribute.DefaultTo<true>;
    fediverse: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    newsletter: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    search: Schema.Attribute.Boolean & Schema.Attribute.Required & Schema.Attribute.DefaultTo<true>;
    support: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
  };
}

export interface SiteSocialLink extends Struct.ComponentSchema {
  collectionName: 'components_site_social_links';
  info: {
    description: 'A profile of the site on another network';
    displayName: 'Social link';
    icon: 'link';
  };
  attributes: {
    network: Schema.Attribute.Enumeration<
      ['github', 'gitlab', 'codeberg', 'linkedin', 'mastodon', 'bluesky', 'x', 'website']
    > &
      Schema.Attribute.Required;
    url: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SiteTheme extends Struct.ComponentSchema {
  collectionName: 'components_site_themes';
  info: {
    description: 'Installed theme and its bounded overrides (micelio ADR 0005). Empty fields use the theme as it is';
    displayName: 'Theme';
    icon: 'brush';
  };
  attributes: {
    accentOverrides: Schema.Attribute.Component<'site.accent-override', true>;
    defaultMode: Schema.Attribute.String;
    displayFont: Schema.Attribute.Enumeration<
      ['archivo', 'fraunces', 'bricolage-grotesque', 'newsreader', 'space-grotesk']
    >;
    themeId: Schema.Attribute.String;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'about.contact': AboutContact;
      'about.contact-link': AboutContactLink;
      'about.fact': AboutFact;
      'about.item': AboutItem;
      'about.link': AboutLink;
      'about.open-source': AboutOpenSource;
      'about.principles': AboutPrinciples;
      'about.profile': AboutProfile;
      'about.project': AboutProject;
      'about.projects': AboutProjects;
      'about.statement': AboutStatement;
      'about.topic': AboutTopic;
      'about.topics': AboutTopics;
      'section.cta': SectionCta;
      'section.faq': SectionFaq;
      'section.faq-item': SectionFaqItem;
      'section.feature-grid': SectionFeatureGrid;
      'section.feature-item': SectionFeatureItem;
      'section.gallery': SectionGallery;
      'section.hero': SectionHero;
      'section.link': SectionLink;
      'section.logo': SectionLogo;
      'section.logo-cloud': SectionLogoCloud;
      'section.media-showcase': SectionMediaShowcase;
      'section.newsletter': SectionNewsletter;
      'section.plan': SectionPlan;
      'section.post-list': SectionPostList;
      'section.pricing': SectionPricing;
      'section.rich-text': SectionRichText;
      'section.scene': SectionScene;
      'section.stat': SectionStat;
      'section.stats': SectionStats;
      'section.testimonial': SectionTestimonial;
      'section.testimonials': SectionTestimonials;
      'shared.image-credit': SharedImageCredit;
      'shared.media': SharedMedia;
      'shared.meta-social': SharedMetaSocial;
      'shared.quote': SharedQuote;
      'shared.reference': SharedReference;
      'shared.rich-text': SharedRichText;
      'shared.seo': SharedSeo;
      'shared.slide': SharedSlide;
      'shared.slider': SharedSlider;
      'shared.tech-item': SharedTechItem;
      'site.accent-override': SiteAccentOverride;
      'site.author': SiteAuthor;
      'site.modules': SiteModules;
      'site.social-link': SiteSocialLink;
      'site.theme': SiteTheme;
    }
  }
}
