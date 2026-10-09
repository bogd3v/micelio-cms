/**
 * Content of the demo instance (`MICELIO_DEMO=true`, #74): a fictional site
 * about a small urban garden, in English and Spanish. Nothing here may name
 * BogDev or a real person; the covers are generated below, so the whole demo
 * ships inside the image and carries no third-party license.
 */

/** Locales the demo content is written in. */
export type DemoLocale = 'en' | 'es';
type Localized<T> = Record<DemoLocale, T>;

/** `DemoLocale` values in the order the seed creates them. */
export const DEMO_LOCALES: DemoLocale[] = ['en', 'es'];

/** Name and description of the demo site, per locale. */
export const DEMO_SITE: Localized<{ name: string; description: string }> = {
  en: {
    name: 'Field Notes',
    description: 'A demo site built with Micelio: notes from a small urban garden.',
  },
  es: {
    name: 'Notas de campo',
    description: 'Un sitio de demostración hecho con Micelio: notas de una pequeña huerta urbana.',
  },
};

/** The fictional author of every demo article; `example.com` is a reserved domain. */
export const DEMO_AUTHOR = { name: 'Alex Moreno', email: 'alex@example.com' };

/** The demo's only link: Micelio itself, the project the visitor is trying. */
export const DEMO_SOCIAL_LINKS = [{ network: 'github', url: 'https://github.com/bogd3v/micelio' }];

/** A demo category, identified by `slug`, with its localized text. */
export interface DemoCategory {
  slug: string;
  text: Localized<{ name: string; description: string }>;
}

/** Categories of the demo site. */
export const DEMO_CATEGORIES: DemoCategory[] = [
  {
    slug: 'garden',
    text: {
      en: { name: 'Garden', description: 'Growing food on balconies, roofs and window sills.' },
      es: { name: 'Huerta', description: 'Cultivar comida en balcones, terrazas y ventanas.' },
    },
  },
  {
    slug: 'kitchen',
    text: {
      en: { name: 'Kitchen', description: 'What to cook with what the garden gives.' },
      es: { name: 'Cocina', description: 'Qué cocinar con lo que da la huerta.' },
    },
  },
];

/** A demo tag, identified by `slug`, with its localized name. */
export interface DemoTag {
  slug: string;
  name: Localized<string>;
}

/** Tags of the demo site. */
export const DEMO_TAGS: DemoTag[] = [
  { slug: 'beginners', name: { en: 'Beginners', es: 'Principiantes' } },
  { slug: 'compost', name: { en: 'Compost', es: 'Compost' } },
  { slug: 'seasonal', name: { en: 'Seasonal', es: 'De temporada' } },
];

type Block =
  | { __component: 'shared.rich-text'; body: string }
  | { __component: 'shared.quote'; title: string; body: string };

/** A demo article: `category` and `tags` are slugs of `DEMO_CATEGORIES` and `DEMO_TAGS`. */
export interface DemoArticle {
  category: string;
  tags: string[];
  /** Colors of the generated cover: background and the two shapes. */
  palette: [string, string, string];
  text: Localized<{ title: string; slug: string; description: string; blocks: Block[] }>;
}

const richText = (body: string): Block => ({ __component: 'shared.rich-text', body });

/** Articles of the demo site. */
export const DEMO_ARTICLES: DemoArticle[] = [
  {
    category: 'garden',
    tags: ['beginners'],
    palette: ['#e8f0e3', '#4f7942', '#c9a227'],
    text: {
      en: {
        title: 'Starting a balcony garden',
        slug: 'starting-a-balcony-garden',
        description: 'Light, pots and three easy plants: everything a first balcony garden needs.',
        blocks: [
          richText(`A balcony with four hours of sun is enough to grow something you can eat. Before buying seeds, watch where the light falls during a whole day.

## Start with three plants

- **Lettuce**, which grows fast and forgives mistakes.
- **Basil**, which likes heat and pots.
- **Cherry tomatoes**, for a balcony with the most sun.

## Pots and soil

Any container with holes in the bottom works. Use fresh potting mix, not soil from a park, and water when the top two centimeters are dry.`),
          {
            __component: 'shared.quote',
            title: 'A rule of thumb',
            body: 'Grow what you like to eat, in the amount you can look after.',
          },
        ],
      },
      es: {
        title: 'Empezar una huerta en el balcón',
        slug: 'empezar-una-huerta-en-el-balcon',
        description:
          'Luz, macetas y tres plantas fáciles: todo lo que necesita una primera huerta.',
        blocks: [
          richText(`Un balcón con cuatro horas de sol basta para cultivar algo que puedas comer. Antes de comprar semillas, observa por dónde cae la luz durante un día entero.

## Empieza con tres plantas

- **Lechuga**, que crece rápido y perdona errores.
- **Albahaca**, a la que le gustan el calor y las macetas.
- **Tomates cherry**, para el balcón con más sol.

## Macetas y sustrato

Sirve cualquier recipiente con agujeros en el fondo. Usa sustrato nuevo, no tierra de un parque, y riega cuando los dos primeros centímetros estén secos.`),
          {
            __component: 'shared.quote',
            title: 'Una regla práctica',
            body: 'Cultiva lo que te gusta comer, en la cantidad que puedas cuidar.',
          },
        ],
      },
    },
  },
  {
    category: 'garden',
    tags: ['compost', 'beginners'],
    palette: ['#efe6da', '#7a5230', '#6b8e23'],
    text: {
      en: {
        title: 'Compost in a small space',
        slug: 'compost-in-a-small-space',
        description: 'Turning kitchen scraps into soil with a bucket, some cardboard and patience.',
        blocks: [
          richText(`Compost does not need a yard. A bucket with a lid and a few holes turns vegetable scraps into soil in about three months.

## Greens and browns

Mix wet **greens** (peels, coffee grounds) with dry **browns** (cardboard, dry leaves) in similar amounts. If it smells, add browns; if nothing happens, add greens and a little water.

## What stays out

Meat, dairy and oil attract pests in a small bin. Leave them for the city's organic waste collection.`),
        ],
      },
      es: {
        title: 'Compost en poco espacio',
        slug: 'compost-en-poco-espacio',
        description:
          'Convertir restos de cocina en tierra con un balde, algo de cartón y paciencia.',
        blocks: [
          richText(`El compost no necesita patio. Un balde con tapa y unos agujeros convierte los restos vegetales en tierra en unos tres meses.

## Verdes y marrones

Mezcla **verdes** húmedos (cáscaras, café usado) con **marrones** secos (cartón, hojas secas) en cantidades parecidas. Si huele, añade marrones; si no pasa nada, añade verdes y un poco de agua.

## Lo que se queda fuera

La carne, los lácteos y el aceite atraen plagas en un compostador pequeño. Déjalos para la recolección de orgánicos de la ciudad.`),
        ],
      },
    },
  },
  {
    category: 'kitchen',
    tags: ['seasonal'],
    palette: ['#fbeee0', '#c0392b', '#2e8b57'],
    text: {
      en: {
        title: 'Cooking with what you grow',
        slug: 'cooking-with-what-you-grow',
        description:
          'Three quick recipes for the weeks when the garden gives more than you expected.',
        blocks: [
          richText(`Some weeks the garden gives more than you can eat fresh. These three ideas use a lot at once.

## Basil pesto

Blend basil, a garlic clove, nuts, olive oil and salt. Freeze it in an ice tray and use one cube per plate of pasta.

## Roasted tomatoes

Halve cherry tomatoes, add oil and salt, and roast them for forty minutes at low heat. They keep for a week in a jar.

## Lettuce soup

Old lettuce is not lost: cook it with potato and onion, blend it and finish it with lemon.`),
        ],
      },
      es: {
        title: 'Cocinar con lo que cultivas',
        slug: 'cocinar-con-lo-que-cultivas',
        description:
          'Tres recetas rápidas para las semanas en que la huerta da más de lo esperado.',
        blocks: [
          richText(`Algunas semanas la huerta da más de lo que puedes comer fresco. Estas tres ideas usan mucho de una vez.

## Pesto de albahaca

Licúa albahaca, un diente de ajo, nueces, aceite de oliva y sal. Congélalo en una cubeta de hielo y usa un cubo por plato de pasta.

## Tomates asados

Parte los tomates cherry por la mitad, añade aceite y sal, y ásalos cuarenta minutos a fuego bajo. Duran una semana en un frasco.

## Sopa de lechuga

La lechuga vieja no se pierde: cocínala con papa y cebolla, licúala y termínala con limón.`),
        ],
      },
    },
  },
];

/** Title and body of the demo About page, per locale. */
export const DEMO_ABOUT: Localized<{ title: string; body: string }> = {
  en: {
    title: 'About',
    body: `**Field Notes** is a demo site that comes with [Micelio](https://github.com/bogd3v/micelio-cms). Its author, Alex Moreno, does not exist: the articles are here so you can see how the blog looks with content.

Change the name, the description and the modules in the admin panel (*Content Manager → Site settings*), and write your own articles to replace these.`,
  },
  es: {
    title: 'Acerca de',
    body: `**Notas de campo** es un sitio de demostración que viene con [Micelio](https://github.com/bogd3v/micelio-cms). Su autor, Alex Moreno, no existe: los artículos están aquí para que veas cómo se ve el blog con contenido.

Cambia el nombre, la descripción y los módulos en el panel de administración (*Content Manager → Site settings*), y escribe tus propios artículos para reemplazar estos.`,
  },
};

/** The demo's mark, used as logo and favicon: a sprout in a circle. */
export const DEMO_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="30" fill="#4f7942"/>
  <path d="M32 50 V30" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
  <path d="M32 32 C 22 32, 17 25, 18 17 C 27 17, 32 23, 32 32 Z" fill="#ffffff"/>
  <path d="M32 36 C 41 36, 47 30, 46 22 C 37 22, 32 28, 32 36 Z" fill="#e8f0e3"/>
</svg>
`;

/** A simple, deterministic cover for an article: a sky, a hill and a sun. */
export function coverSvg([background, hill, sun]: [string, string, string]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${background}"/>
  <circle cx="900" cy="190" r="90" fill="${sun}"/>
  <path d="M0 470 C 250 330, 520 360, 760 440 S 1080 520, 1200 430 L 1200 630 L 0 630 Z" fill="${hill}"/>
  <path d="M0 540 C 300 470, 640 500, 1200 520 L 1200 630 L 0 630 Z" fill="${hill}" opacity="0.6"/>
</svg>
`;
}

/** A small square icon for the feature grid and the logo cloud. */
export function iconSvg(color: string, shape: 'circle' | 'square' | 'triangle'): string {
  const mark = {
    circle: `<circle cx="32" cy="32" r="18" fill="${color}"/>`,
    square: `<rect x="15" y="15" width="34" height="34" rx="6" fill="${color}"/>`,
    triangle: `<path d="M32 12 L54 50 H10 Z" fill="${color}"/>`,
  }[shape];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${mark}</svg>\n`;
}

/**
 * The smallest useful glTF for the `scene` section: one triangle, its buffer
 * embedded as a data URI, so the demo needs no binary file.
 */
export function triangleGltf(): string {
  const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  return JSON.stringify({
    asset: { version: '2.0', generator: 'micelio-cms demo seed' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [
      {
        byteLength: positions.length,
        uri: `data:application/octet-stream;base64,${positions.toString('base64')}`,
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
  });
}

/** Slug of the showcase page, per locale. */
export const DEMO_SHOWCASE_SLUG: Localized<string> = { en: 'showcase', es: 'muestra' };

/** Media the showcase page uses, uploaded by the seed. */
export interface ShowcaseMedia {
  hero: number;
  icons: [number, number, number];
  logos: [number, number, number];
  gallery: number[];
  poster: number;
  model: number;
  /** documentId of the category the post list shows. */
  category: string;
}

/**
 * A page that uses every section of the catalog once, to see how the theme
 * styles each of them (#75, #84).
 */
export function showcaseSections(locale: DemoLocale, media: ShowcaseMedia) {
  const es = locale === 'es';
  const t = (en: string, spanish: string) => (es ? spanish : en);
  const blog = es ? '/es/blog' : '/blog';
  return [
    {
      __component: 'section.hero',
      variant: 'split',
      title: t('Grow food where you live', 'Cultiva comida donde vives'),
      text: t(
        'Field Notes is a demo of every section a Micelio page can use.',
        'Notas de campo es una muestra de todas las secciones que puede usar una página de Micelio.'
      ),
      primaryLink: { label: t('Read the notes', 'Leer las notas'), url: blog },
      secondaryLink: { label: 'Micelio', url: 'https://github.com/bogd3v/micelio' },
      media: media.hero,
    },
    {
      __component: 'section.feature-grid',
      variant: 'grid',
      title: t('What you need', 'Lo que necesitas'),
      items: [
        {
          icon: media.icons[0],
          title: t('Light', 'Luz'),
          text: t('Four hours of sun.', 'Cuatro horas de sol.'),
        },
        {
          icon: media.icons[1],
          title: t('Pots', 'Macetas'),
          text: t('Any container with holes.', 'Cualquier recipiente con agujeros.'),
        },
        {
          icon: media.icons[2],
          title: t('Patience', 'Paciencia'),
          text: t('A season or two.', 'Una o dos temporadas.'),
        },
      ],
    },
    {
      __component: 'section.media-showcase',
      variant: 'left',
      title: t('A balcony in spring', 'Un balcón en primavera'),
      text: t('Lettuce, basil and **cherry tomatoes**.', 'Lechuga, albahaca y **tomates cherry**.'),
      media: media.gallery[0],
      link: {
        label: t('How to start', 'Cómo empezar'),
        url: `${blog}/${t('starting-a-balcony-garden', 'empezar-una-huerta-en-el-balcon')}`,
      },
    },
    {
      __component: 'section.stats',
      variant: 'cards',
      title: t('One small garden', 'Una huerta pequeña'),
      items: [
        { value: '4 h', label: t('of sun a day', 'de sol al día') },
        { value: '12', label: t('pots', 'macetas') },
        { value: '3', label: t('months to compost', 'meses para el compost') },
      ],
    },
    {
      __component: 'section.logo-cloud',
      variant: 'row',
      title: t('Friends of the garden', 'Amigos de la huerta'),
      logos: [
        { image: media.logos[0], name: 'Circle Seeds' },
        { image: media.logos[1], name: 'Square Soil' },
        { image: media.logos[2], name: 'Triangle Tools' },
      ],
    },
    {
      __component: 'section.testimonials',
      variant: 'grid',
      title: t('What neighbors say', 'Lo que dicen los vecinos'),
      items: [
        {
          quote: t(
            'The basil smells all the way to the street.',
            'La albahaca se huele hasta la calle.'
          ),
          author: 'Sam',
          role: t('Neighbor', 'Vecino'),
        },
        {
          quote: t(
            'I started my own pots after reading this.',
            'Empecé mis macetas después de leer esto.'
          ),
          author: 'Robin',
        },
      ],
    },
    {
      __component: 'section.pricing',
      variant: 'cards',
      title: t('Seed boxes', 'Cajas de semillas'),
      text: t('Fictional plans, to see the section.', 'Planes ficticios, para ver la sección.'),
      plans: [
        {
          name: t('Starter', 'Inicial'),
          price: '$5',
          period: t('per season', 'por temporada'),
          features: t(
            '3 seed packs\nA planting guide',
            '3 sobres de semillas\nUna guía de siembra'
          ),
        },
        {
          name: t('Gardener', 'Huertera'),
          price: '$12',
          period: t('per season', 'por temporada'),
          features: t(
            '8 seed packs\nA planting guide\nCompost starter',
            '8 sobres de semillas\nUna guía de siembra\nIniciador de compost'
          ),
          recommended: true,
          link: { label: t('Choose', 'Elegir'), url: '/' },
        },
      ],
    },
    {
      __component: 'section.faq',
      variant: 'list',
      title: t('Questions', 'Preguntas'),
      items: [
        {
          question: t('Do I need a garden?', '¿Necesito un jardín?'),
          answer: t(
            'No: a balcony or a window sill is enough.',
            'No: basta un balcón o una ventana.'
          ),
        },
        {
          question: t('Is this site real?', '¿Este sitio es real?'),
          answer: t(
            'It is a demo of [Micelio](https://github.com/bogd3v/micelio).',
            'Es una demostración de [Micelio](https://github.com/bogd3v/micelio).'
          ),
        },
      ],
    },
    {
      __component: 'section.cta',
      variant: 'banner',
      title: t('Start this weekend', 'Empieza este fin de semana'),
      text: t('One pot, one plant.', 'Una maceta, una planta.'),
      primaryLink: { label: t('Read the guide', 'Leer la guía'), url: blog },
    },
    {
      __component: 'section.post-list',
      variant: 'cards',
      title: t('From the garden', 'Desde la huerta'),
      category: media.category,
      count: 3,
    },
    {
      __component: 'section.newsletter',
      variant: 'card',
      title: t('Notes by email', 'Notas por correo'),
      text: t('One email per season.', 'Un correo por temporada.'),
      buttonLabel: t('Subscribe', 'Suscribirme'),
    },
    {
      __component: 'section.rich-text',
      body: t(
        '## About this page\n\nEvery section of the catalog appears once, with one of its variants. Change the variants in the admin panel to see the others.',
        '## Sobre esta página\n\nCada sección del catálogo aparece una vez, con una de sus variantes. Cambia las variantes en el panel de administración para ver las demás.'
      ),
    },
    {
      __component: 'section.gallery',
      variant: 'grid',
      title: t('Through the year', 'A lo largo del año'),
      images: media.gallery,
    },
    {
      __component: 'section.scene',
      variant: 'inline',
      model: media.model,
      poster: media.poster,
      alt: t(
        'A green triangle, the simplest 3D model',
        'Un triángulo verde, el modelo 3D más simple'
      ),
      title: t('A scene', 'Una escena'),
      text: t('3D loads only when you reach it.', 'El 3D solo carga cuando llegas a él.'),
    },
  ];
}
