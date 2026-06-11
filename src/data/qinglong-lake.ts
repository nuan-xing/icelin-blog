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
    title: '呼吸之根',
    pubDate: new Date('2026-06-09'),
    image: '/images/qinglong-lake/2026-06-09-breathing-roots.jpg',
    alt: '青龙湖公园树旁向上生长的呼吸根。',
    caption: '树旁边向上生长的呼吸根，像从土地里伸出来的小小呼吸。',
    tags: ['青龙湖', '自然'],
  },
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
  {
    title: '在湖边骑行',
    pubDate: new Date('2026-05-04'),
    image: '/images/qinglong-lake/2026-05-04-lake-ride.jpg',
    alt: '青龙湖公园湖边骑行时拍下的照片。',
    caption: '沿着湖边慢慢骑，风从身边经过。',
    tags: ['青龙湖', '骑行'],
  },
  {
    title: '搭帐篷 x2',
    pubDate: new Date('2026-04-25'),
    image: '/images/qinglong-lake/2026-04-25-camping-02.jpg',
    alt: '青龙湖公园第二次搭帐篷时拍下的照片。',
    caption: '又一次把帐篷撑起来，像给周末留出一小块安静地方。',
    tags: ['青龙湖', '帐篷'],
  },
  {
    title: '第一次搭帐篷',
    pubDate: new Date('2026-04-23'),
    image: '/images/qinglong-lake/2026-04-23-first-camping.jpg',
    alt: '青龙湖公园第一次搭帐篷时拍下的照片。',
    caption: '第一次在湖边搭帐篷，认真地把生活展开一点。',
    tags: ['青龙湖', '帐篷'],
  },
  {
    title: '田野行',
    pubDate: new Date('2026-04-14'),
    image: '/images/qinglong-lake/2026-04-14-field-walk.jpg',
    alt: '青龙湖公园附近田野行走时拍下的照片。',
    caption: '走到更开阔的地方，风和草都慢下来。',
    tags: ['青龙湖', '田野'],
  },
  {
    title: '睡吊床',
    pubDate: new Date('2026-04-06'),
    image: '/images/qinglong-lake/2026-04-06-hammock.jpg',
    alt: '青龙湖公园树下吊床和阳光里的照片。',
    caption: '把吊床挂在树下，躺进一小片阳光和风里。',
    tags: ['青龙湖', '吊床'],
  },
  {
    title: '鬼知道5分钟之后我从一个湿滑的斜坡上摔下来',
    pubDate: new Date('2026-04-02'),
    image: '/images/qinglong-lake/2026-04-02-slippery-slope.jpg',
    alt: '青龙湖公园湿滑斜坡附近拍下的照片。',
    caption: '这一刻还好好的，五分钟之后就从湿滑的斜坡上摔下来了。',
    tags: ['青龙湖', '日常'],
  },
];
