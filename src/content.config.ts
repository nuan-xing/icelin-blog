import { defineCollection, z } from 'astro:content';

const writing = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const photos = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    location: z.string().optional(),
    pubDate: z.coerce.date(),
    image: z.string(),
    alt: z.string(),
    caption: z.string().optional(),
  }),
});

const topicPhoto = z.object({
  title: z.string(),
  pubDate: z.coerce.date(),
  image: z.string(),
  alt: z.string(),
  caption: z.string().optional(),
});

const topics = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    coverImage: z.string(),
    coverAlt: z.string(),
    eyebrow: z.string().optional(),
    photos: z.array(topicPhoto).default([]),
  }),
});

export const collections = { writing, photos, topics };
