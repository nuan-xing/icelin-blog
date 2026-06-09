export type QinglongLakePhoto = {
  title: string;
  pubDate: Date;
  image: string;
  alt: string;
  caption?: string;
  tags?: string[];
};

export const qinglongLakePhotos: QinglongLakePhoto[] = [
  {
    title: '新书到了，来看看吧',
    pubDate: new Date('2026-05-30'),
    image: '/images/qinglong-lake/2026-05-30-new-book.jpg',
    alt: '青龙湖公园里与新书有关的一张照片。',
    caption: '把新书带到湖边，慢慢翻几页。',
    tags: ['青龙湖', '阅读'],
  },
  {
    title: '好天气，晒太阳',
    pubDate: new Date('2026-05-10'),
    image: '/images/qinglong-lake/2026-05-10-sunshine.jpg',
    alt: '青龙湖公园好天气里的阳光和自然景色。',
    caption: '天气很好，适合把自己放进阳光里。',
    tags: ['青龙湖', '阳光'],
  },
];
