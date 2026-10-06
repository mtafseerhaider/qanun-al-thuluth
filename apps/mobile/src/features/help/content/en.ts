import type { HelpContent } from './types';

/**
 * English help articles (S6-12). Drafted by engineering from docs/02 and docs/15; the content team
 * reviews them before release (locales/README.md, Sprint 6 note).
 */
export const HELP_EN: HelpContent = {
  locale: 'en',
  draft: false,
  articles: [
    {
      slug: 'what-is-thuluth',
      category: 'getting_started',
      title: 'What is Thuluth?',
      body: [
        'Thuluth plans family meals around the Prophetic guidance of a third for food, a third for drink and a third for breath, together with current nutrition science.',
        'It builds weekly meal plans for everyone in your household, makes a grocery list, and helps you keep track of water, fasting and how meals went.',
        'Thuluth gives general guidance. It does not diagnose or treat illness, and it never replaces your doctor.',
      ],
      keywords: ['about', 'thirds', 'thuluth', 'app'],
    },
    {
      slug: 'set-up-household',
      category: 'getting_started',
      title: 'Setting up your household',
      body: [
        'A household is the family that eats together. The person who creates it is the owner.',
        'Add your country and city so prayer times, prices and local foods are right, and choose your units and language in Settings.',
        "You can belong to more than one household, for example your own and your parents'. Switch between them from the household name at the top of Today.",
      ],
      keywords: ['family', 'owner', 'home', 'create'],
    },
    {
      slug: 'add-family-members',
      category: 'getting_started',
      title: 'Adding family members',
      body: [
        'Open the Family tab and tap Add member. A name and date of birth are enough to start; health details can be added later.',
        'For children, we ask you to confirm consent for their information first. Children never see calorie or weight targets, and their growth is followed on growth charts instead.',
        'Each member can have modules such as picky eating, autism support or pregnancy, which change how their meals are planned.',
      ],
      keywords: ['member', 'child', 'kids', 'profile', 'add'],
    },
    {
      slug: 'invite-caregiver',
      category: 'getting_started',
      title: 'Inviting a caregiver',
      body: [
        'Owners can invite another adult, such as a spouse, grandparent or nanny, from Family, Caregivers.',
        'Caregivers can log meals and water and see plans. Viewers can only look. Only parents and caregivers see growth details.',
        'Invitations expire after 7 days. You can remove a caregiver at any time.',
      ],
      keywords: ['invite', 'spouse', 'share', 'caregiver', 'viewer'],
    },
    {
      slug: 'switch-language',
      category: 'getting_started',
      title: 'Changing the language',
      body: [
        'Go to More, Settings, Language and choose English or Urdu. The app switches right away, including right-to-left layout for Urdu.',
        'Exports can be created in either language, whatever the app language is.',
      ],
      keywords: ['urdu', 'english', 'language', 'rtl'],
    },
    {
      slug: 'generate-meal-plan',
      category: 'plans',
      title: 'Creating a meal plan',
      body: [
        "From the Plan tab, tap Create plan. Thuluth uses everyone's health profile, preferences and budget to build a week of meals.",
        'Generation usually takes under a minute. You can leave the screen; we will let you know when it is ready.',
        'Review the plan, then tap Start this plan to make it active. Only one plan is active at a time.',
      ],
      keywords: ['plan', 'generate', 'week', 'create', 'menu'],
    },
    {
      slug: 'swap-a-meal',
      category: 'plans',
      title: 'Swapping a meal',
      body: [
        'Open a meal and tap Swap. You will see options that fit the same people and the same part of the day.',
        'Premium members can also ask for a change in their own words, for example "less rice this week" or "vegetarian on Mondays".',
      ],
      keywords: ['swap', 'change', 'replace', 'adjust'],
    },
    {
      slug: 'log-what-was-eaten',
      category: 'plans',
      title: 'Logging what was eaten',
      body: [
        'After a meal, tap the meal on Today and choose how it went for each person, from "Not today" to "Ate well".',
        'For children this is about acceptance, not amounts. There is no clean-plate goal.',
        'Logs save on your phone first, so they work without a connection and sync later.',
      ],
      keywords: ['log', 'eaten', 'acceptance', 'track'],
    },
    {
      slug: 'grocery-list',
      category: 'plans',
      title: 'Your grocery list',
      body: [
        'Each plan can make a grocery list grouped by aisle. Tick items off as you shop; Shopping mode keeps the screen awake.',
        'Where we have local prices, you will see an estimate for the week. Prices are approximate.',
      ],
      keywords: ['grocery', 'shopping', 'list', 'prices', 'budget'],
    },
    {
      slug: 'offline-use',
      category: 'plans',
      title: 'Using Thuluth offline',
      body: [
        'You can see your current plan and log meals, water, fasts, measurements and food tries without a connection.',
        'Items saved offline show "Saved on this device" and send automatically when you are back online.',
        'Creating plans, the assistant and exports need a connection.',
      ],
      keywords: ['offline', 'internet', 'sync', 'no connection'],
    },
    {
      slug: 'measure-child-at-home',
      category: 'health',
      title: 'Measuring your child at home',
      body: [
        'Weigh your child at the same time of day, in light clothes, without shoes. Under 2 years, weigh yourself holding the baby and subtract your own weight.',
        'Under 2 years, measure length lying down on a flat surface with the head against a wall. From 2 years, measure height standing, back against a wall, heels together.',
        'Head circumference (under 2 years) is measured around the widest part of the head, just above the eyebrows.',
        'Measuring once a month for babies and every few months for older children is plenty. If a value looks odd, measure again.',
      ],
      keywords: ['measure', 'height', 'weight', 'length', 'head', 'growth'],
    },
    {
      slug: 'growth-chart-percentiles',
      category: 'health',
      title: 'Understanding growth charts',
      body: [
        'A percentile compares your child with healthy children of the same age and sex on the WHO charts. The 50th percentile is the middle; the 25th means 25 out of 100 children are smaller.',
        'What matters most is that a child follows their own curve over time. A child on the 10th percentile who stays there is usually growing well.',
        'Free accounts see the latest values. Premium shows the full chart with reference lines and history.',
      ],
      keywords: ['percentile', 'chart', 'who', 'growth', 'curve'],
    },
    {
      slug: 'growth-alerts',
      category: 'health',
      title: 'When we suggest seeing a doctor',
      body: [
        "If a measurement is very low for age, crosses two major percentile lines, or shows quick weight loss, we suggest booking a visit with your child's doctor.",
        'While that is checked, new growth plans for the child are paused. Everyday family meals carry on as before.',
        "An alert is never anyone's fault. Bring the chart or a growth report to the appointment.",
      ],
      keywords: ['alert', 'doctor', 'red flag', 'paused', 'paediatrician'],
    },
    {
      slug: 'picky-eating-basics',
      category: 'health',
      title: 'Picky eating: the basics',
      body: [
        'Many children go through picky phases. Pressure, bribes and praise for eating usually make it last longer.',
        'Try the Division of Responsibility: you decide what, when and where food is served; your child decides whether and how much to eat.',
        'Serve a food your child usually eats at every meal, and offer new foods often, in small amounts, without asking for a bite.',
        'Talk to your doctor if eating is very limited, meals are very stressful, or you are worried about growth.',
      ],
      keywords: ['picky', 'fussy', 'refuses', 'division of responsibility'],
    },
    {
      slug: 'exposure-pairs',
      category: 'health',
      title: 'New food of the week',
      body: [
        'For members with the picky-eating module, Premium plans pair one new food with a familiar one each week.',
        'Put the new food on the table and let your child see, touch or smell it. Seeing a food 10 to 15 times is often what it takes.',
        'Log each try with Log a try. "Not today" is a normal answer.',
      ],
      keywords: ['new food', 'exposure', 'pair', 'week'],
    },
    {
      slug: 'safe-foods',
      category: 'health',
      title: 'Safe foods',
      body: [
        'Safe foods are foods your child reliably eats. Plans include one at every meal, so there is always something to eat.',
        "If a safe food stops working, mark it as no longer safe instead of deleting it. It is kept as a note, because the change matters to your child's therapist.",
      ],
      keywords: ['safe food', 'autism', 'arfid', 'reliable'],
    },
    {
      slug: 'exposure-ladders',
      category: 'health',
      title: 'Exposure ladders',
      body: [
        'A ladder breaks one new food into small steps: on the table, look, touch, smell, lick, taste, chew and spit, eat a little, eat a portion.',
        'After three calm tries at a step, we suggest moving up. After two hard tries in a row, we suggest a step back. You always decide.',
        "Ladders are part of Premium. Work with your child's feeding therapist if you have one.",
      ],
      keywords: ['ladder', 'steps', 'exposure', 'autism'],
    },
    {
      slug: 'food-chaining',
      category: 'health',
      title: 'Food chaining',
      body: [
        'Food chaining moves from a food your child accepts toward a new one through similar foods, for example from plain crackers to toast to roti.',
        'We suggest bridge foods by texture and colour, using the sensory profile. Check each suggestion is right for your child before saving.',
      ],
      keywords: ['chain', 'chaining', 'bridge', 'similar'],
    },
    {
      slug: 'sensory-profile',
      category: 'health',
      title: 'The sensory profile',
      body: [
        'The sensory profile records textures your child likes or avoids, colours, temperature, and how food is presented (separate foods, divided plate, sauce on the side).',
        'Plans and food chains follow it. You can update it at any time from the autism module.',
      ],
      keywords: ['sensory', 'texture', 'colour', 'presentation'],
    },
    {
      slug: 'hydration-tracking',
      category: 'health',
      title: 'Tracking water',
      body: [
        'Each member gets a daily water target based on age, weight and climate. Tap a cup size to log.',
        'Children see cups, not millilitres. Water with or after a meal counts; the guidance is to leave a third of the stomach for drink.',
      ],
      keywords: ['water', 'hydration', 'drink', 'cups'],
    },
    {
      slug: 'ramadan-planner',
      category: 'ramadan',
      title: 'The Ramadan planner',
      body: [
        'Set up Ramadan from More, Ramadan to choose who is fasting. Premium creates suhoor and iftar plans for the whole month.',
        'Suhoor plans favour slow-release foods and water; iftar starts gently, following the Sunnah of dates and water.',
      ],
      keywords: ['ramadan', 'suhoor', 'iftar', 'sehri', 'fast'],
    },
    {
      slug: 'children-and-fasting',
      category: 'ramadan',
      title: 'Children and fasting',
      body: [
        'Children under 7 are never logged as fasting. From 7, children can try practice fasts, such as half days.',
        "Fasting is not obligatory before puberty. Stop a child's fast if they feel dizzy, very tired, or unwell.",
      ],
      keywords: ['children', 'kids', 'practice fast', 'roza'],
    },
    {
      slug: 'fasting-with-medical-conditions',
      category: 'ramadan',
      title: 'Fasting with a health condition',
      body: [
        'If you take insulin or sulfonylureas, are pregnant or breastfeeding, or have kidney disease, speak to your doctor before Ramadan.',
        'Islam allows those who are ill to make up fasts later or give fidya. Thuluth shows the clinician card for these cases.',
        'Break your fast and seek help if you feel faint, confused, or very unwell.',
      ],
      keywords: ['diabetes', 'insulin', 'pregnant', 'medical', 'exemption'],
    },
    {
      slug: 'your-data-and-privacy',
      category: 'privacy',
      title: 'Your data and privacy',
      body: [
        "Your family's health information is stored securely and is only visible to the people in your household you have given access to.",
        "We never sell your data. Product analytics never include health values, food names, notes or children's details, and you can turn them off.",
        'You can withdraw optional consents in More, Privacy and data.',
      ],
      keywords: ['privacy', 'data', 'security', 'consent'],
    },
    {
      slug: 'download-my-data',
      category: 'privacy',
      title: 'Downloading your data',
      body: [
        'Go to More, Privacy and data, Download my data. For your security we may ask for a code sent to your email.',
        'We prepare a file with everything you can see in the app and email you a link. The link works for 24 hours.',
      ],
      keywords: ['download', 'export', 'copy', 'gdpr'],
    },
    {
      slug: 'delete-my-account',
      category: 'privacy',
      title: 'Deleting your account',
      body: [
        'Go to More, Privacy and data, Delete account, and confirm with a code sent to your email.',
        'Your account is deleted after 30 days. Until then you can sign in and cancel. If you own a household with other members, make someone else the owner first.',
        'Store subscriptions are not cancelled automatically; cancel them in the App Store or Google Play.',
      ],
      keywords: ['delete', 'remove account', 'close', 'erase'],
    },
    {
      slug: 'analytics-opt-out',
      category: 'privacy',
      title: 'Turning off analytics',
      body: [
        'In More, Privacy and data, tick "Don\'t send usage analytics". Nothing more is sent from that moment, and events waiting on your phone are cleared.',
      ],
      keywords: ['analytics', 'tracking', 'opt out', 'telemetry'],
    },
    {
      slug: 'premium-features',
      category: 'subscription',
      title: 'What Premium adds',
      body: [
        'Premium adds multi-week and adjustable plans, the full growth chart, exposure ladders and food chaining, coaching tips, insights, the Ramadan plan, exports and more assistant messages.',
        'Safety features, such as growth alerts and red-flag guidance, are free for everyone.',
      ],
      keywords: ['premium', 'subscription', 'price', 'features', 'upgrade'],
    },
    {
      slug: 'manage-subscription',
      category: 'subscription',
      title: 'Managing your subscription',
      body: [
        "Subscriptions are handled by the App Store or Google Play. To cancel or change plans, open your store account's subscriptions page.",
        'If you changed phones, tap Restore purchases in More, Subscription.',
      ],
      keywords: ['cancel', 'refund', 'restore', 'billing'],
    },
    {
      slug: 'emergency-help',
      category: 'safety',
      title: 'In an emergency',
      body: [
        'Thuluth is not an emergency service. If someone is seriously unwell, call your local emergency number now.',
        '• Pakistan: 1122',
        '• United Kingdom: 999, or 111 for urgent advice',
        '• United States and Canada: 911',
        '• Saudi Arabia: 997',
        '• United Arab Emirates: 998',
        'Signs that need urgent help include trouble breathing, a child who is very drowsy or floppy, signs of severe dehydration, or fainting.',
      ],
      keywords: ['emergency', 'ambulance', '1122', '999', '911', 'urgent'],
    },
  ],
};
