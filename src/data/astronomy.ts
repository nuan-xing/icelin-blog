export type AstronomyPhoto = {
  title: string;
  pubDate: Date;
  image: string;
  alt: string;
  caption?: string;
  tags?: string[];
};

export const astronomyPhotos: AstronomyPhoto[] = [
  {
    title: '色球层',
    pubDate: new Date('2026-08-17'),
    image: '/images/photos/sun_horizontal_lines_removed_final.webp',
    alt: '太阳色球层的 Hα 扫描图像。',
    caption: '用一维把太阳一次一次扫过，从 Hα 谱线里拼回完整的日面。',
    tags: ['太阳', 'Hα'],
  },
  {
    title: '太阳黑子',
    pubDate: new Date('2026-02-04'),
    image: '/images/photos/2026-02-04-sunspot.webp',
    alt: '太阳表面的黑子图像。',
    caption: '像一朵向日葵绽放。',
    tags: ['太阳', '日面'],
  },
  {
    title: '月食之日',
    pubDate: new Date('2025-09-08'),
    image: '/images/photos/2025-09-08-lunar-eclipse.webp',
    alt: '月食之日拍下的月亮。',
    caption: '即便天空被遮蔽依然展现身影。',
    tags: ['月亮', '月食'],
  },
  {
    title: '你曾肉眼见过银河吗',
    pubDate: new Date('2025-08-16'),
    image: '/images/photos/2025-08-16-milky-way.webp',
    alt: '夜空中肉眼可见的银河。',
    caption: '你一旦见过就会明白“Milky Way”和“银河”这两个名字的震撼之处。',
    tags: ['银河', '夜空'],
  },
];
