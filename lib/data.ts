export type Creator = {
  username: string;
  name: string;
  occupation: string;
  location: string;
  flag: string;
  followers: string;
  impressions: string;
  bio: string;
  avatar: string;
  dayTitle: string;
  dayDate: string;
  category: string;
  slots: { tier: 'Primary' | 'Featured' | 'Supporting'; price: number; taken: boolean }[];
  slotsTaken: number;
  slotsTotal: number;
};

export const creators: Creator[] = [
  {
    username: '@raghvendra',
    name: 'Raghvendra',
    occupation: 'Software Developer',
    location: 'Rotterdam',
    flag: 'NL',
    followers: '4.2K',
    impressions: '~18K monthly',
    bio: 'Building an AI SaaS in public',
    avatar: 'https://images.pexels.com/photos/6942776/pexels-photo-6942776.jpeg?auto=compress&cs=tinysrgb&h=400&w=400',
    dayTitle: "Building my AI startup",
    dayDate: 'Sept 18',
    category: 'Developer',
    slots: [
      { tier: 'Primary', price: 299, taken: false },
      { tier: 'Featured', price: 149, taken: true },
      { tier: 'Supporting', price: 79, taken: false },
    ],
    slotsTaken: 1,
    slotsTotal: 3,
  },
  {
    username: '@sarahbuilds',
    name: 'Sarah',
    occupation: 'Product Designer',
    location: 'Berlin',
    flag: 'DE',
    followers: '8.1K',
    impressions: '~42K monthly',
    bio: 'Designing in public, shipping weekly',
    avatar: 'https://images.pexels.com/photos/33680700/pexels-photo-33680700.jpeg?auto=compress&cs=tinysrgb&h=400&w=400',
    dayTitle: 'Design sprint & client demos',
    dayDate: 'Sept 20',
    category: 'Design',
    slots: [
      { tier: 'Primary', price: 399, taken: false },
      { tier: 'Featured', price: 199, taken: false },
      { tier: 'Supporting', price: 99, taken: true },
    ],
    slotsTaken: 1,
    slotsTotal: 3,
  },
  {
    username: '@alexdev',
    name: 'Alex',
    occupation: 'Full-stack Developer',
    location: 'Amsterdam',
    flag: 'NL',
    followers: '2.8K',
    impressions: '~35K monthly',
    bio: 'Coding 12 hours for a launch',
    avatar: 'https://images.pexels.com/photos/749091/pexels-photo-749091.jpeg?auto=compress&cs=tinysrgb&h=400&w=400',
    dayTitle: 'SaaS launch day marathon',
    dayDate: 'Sept 22',
    category: 'Developer',
    slots: [
      { tier: 'Primary', price: 249, taken: false },
      { tier: 'Featured', price: 129, taken: false },
      { tier: 'Supporting', price: 69, taken: false },
    ],
    slotsTaken: 0,
    slotsTotal: 3,
  },
  {
    username: '@priya',
    name: 'Priya',
    occupation: 'Tech Content Creator',
    location: 'London',
    flag: 'UK',
    followers: '12K',
    impressions: '~85K monthly',
    bio: 'Reviewing dev tools & AI products',
    avatar: 'https://images.pexels.com/photos/7717254/pexels-photo-7717254.jpeg?auto=compress&cs=tinysrgb&h=400&w=400',
    dayTitle: 'Dev conference & networking',
    dayDate: 'Sept 25',
    category: 'Tech',
    slots: [
      { tier: 'Primary', price: 499, taken: true },
      { tier: 'Featured', price: 249, taken: false },
      { tier: 'Supporting', price: 129, taken: false },
    ],
    slotsTaken: 1,
    slotsTotal: 3,
  },
  {
    username: '@tomtravels',
    name: 'Tom',
    occupation: 'Travel Creator',
    location: 'Lisbon',
    flag: 'PT',
    followers: '6.5K',
    impressions: '~28K monthly',
    bio: 'Digital nomad, working from everywhere',
    avatar: 'https://images.pexels.com/photos/5308640/pexels-photo-5308640.jpeg?auto=compress&cs=tinysrgb&h=400&w=400',
    dayTitle: 'Coworking & city exploration',
    dayDate: 'Sept 26',
    category: 'Travel',
    slots: [
      { tier: 'Primary', price: 299, taken: false },
      { tier: 'Featured', price: 159, taken: false },
      { tier: 'Supporting', price: 89, taken: true },
    ],
    slotsTaken: 1,
    slotsTotal: 3,
  },
  {
    username: '@maya',
    name: 'Maya',
    occupation: 'Startup Founder',
    location: 'Stockholm',
    flag: 'SE',
    followers: '3.1K',
    impressions: '~22K monthly',
    bio: 'Building a fintech in public',
    avatar: 'https://images.pexels.com/photos/7562139/pexels-photo-7562139.jpeg?auto=compress&cs=tinysrgb&h=400&w=400',
    dayTitle: 'Pitch day & investor meetings',
    dayDate: 'Sept 28',
    category: 'Startup',
    slots: [
      { tier: 'Primary', price: 349, taken: false },
      { tier: 'Featured', price: 179, taken: false },
      { tier: 'Supporting', price: 89, taken: false },
    ],
    slotsTaken: 0,
    slotsTotal: 3,
  },
];

export type ActivityItem = {
  brand: string;
  brandColor: string;
  creator: string;
  dayType: string;
  amount: number;
  time: string;
};

export const activityFeed: ActivityItem[] = [
  { brand: 'Cursor', brandColor: 'bg-blue-500', creator: "@alexdev", dayType: "Coding Day", amount: 249, time: '2 min ago' },
  { brand: 'Notion', brandColor: 'bg-slate-800', creator: "@sarahbuilds", dayType: "Startup Day", amount: 149, time: '8 min ago' },
  { brand: 'Anker', brandColor: 'bg-emerald-600', creator: "@tomtravels", dayType: "Travel Day", amount: 299, time: '17 min ago' },
  { brand: 'Linear', brandColor: 'bg-indigo-600', creator: "@raghvendra", dayType: "Developer Day", amount: 149, time: '31 min ago' },
  { brand: 'Raycast', brandColor: 'bg-rose-500', creator: "@priya", dayType: "Conference Day", amount: 249, time: '45 min ago' },
  { brand: 'Figma', brandColor: 'bg-orange-500', creator: "@maya", dayType: "Pitch Day", amount: 179, time: '1 hr ago' },
];

export const categories = [
  'Developer', 'AI', 'Design', 'Travel', 'Fitness', 'Food', 'Gaming', 'Startup', 'Student', 'Tech',
];

export const marketplaceStats = [
  { label: 'Paid to creators', value: '€18,420', sub: 'and growing' },
  { label: 'Sponsored days', value: '127', sub: 'completed' },
  { label: 'Brands participating', value: '84', sub: 'and counting' },
  { label: 'Products tested', value: '2,841', sub: 'real experiences' },
];
