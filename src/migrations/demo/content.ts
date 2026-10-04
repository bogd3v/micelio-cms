/**
 * Content of the demo instance (`MICELIO_DEMO=true`, #74): a fictional site
 * about a small urban garden, in English and Spanish. Nothing here may name
 * BogDev or a real person; the covers are generated below, so the whole demo
 * ships inside the image and carries no third-party license.
 */

export type DemoLocale = 'en' | 'es';
type Localized<T> = Record<DemoLocale, T>;

export const DEMO_LOCALES: DemoLocale[] = ['en', 'es'];

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

export const DEMO_AUTHOR = { name: 'Alex Moreno', email: 'alex@example.com' };

/** The demo's only link: Micelio itself, the project the visitor is trying. */
export const DEMO_SOCIAL_LINKS = [{ network: 'github', url: 'https://github.com/bogd3v/micelio' }];

export interface DemoCategory {
  slug: string;
  text: Localized<{ name: string; description: string }>;
}

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

export interface DemoTag {
  slug: string;
  name: Localized<string>;
}

export const DEMO_TAGS: DemoTag[] = [
  { slug: 'beginners', name: { en: 'Beginners', es: 'Principiantes' } },
  { slug: 'compost', name: { en: 'Compost', es: 'Compost' } },
  { slug: 'seasonal', name: { en: 'Seasonal', es: 'De temporada' } },
];

type Block =
  | { __component: 'shared.rich-text'; body: string }
  | { __component: 'shared.quote'; title: string; body: string };

export interface DemoArticle {
  category: string;
  tags: string[];
  /** Colors of the generated cover: background and the two shapes. */
  palette: [string, string, string];
  text: Localized<{ title: string; slug: string; description: string; blocks: Block[] }>;
}

const richText = (body: string): Block => ({ __component: 'shared.rich-text', body });

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
