"use client";

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaxResult {
  incomeTax: number;
  nationalInsurance: number;
  totalCentralContribution: number;
  belowThreshold: boolean;
}

interface CouncilResult {
  bandD: number;
  authorityName: string;
}

interface SpendingItem {
  category: string;
  emoji: string;
  description: string;
  details: string[];
  proportion: number;
  color: string;
  userAmount: number;
}

interface PageResult {
  tax: TaxResult;
  council: CouncilResult;
  centralItems: SpendingItem[];
  localItems: SpendingItem[];
}

// ---------------------------------------------------------------------------
// Tax calculation
// ---------------------------------------------------------------------------

function calculateTax(grossSalary: number): TaxResult {
  const belowThreshold = grossSalary <= 12570;
  let incomeTax = 0;
  if (grossSalary > 125140) {
    incomeTax += (grossSalary - 125140) * 0.45;
    incomeTax += (125140 - 50270) * 0.4;
    incomeTax += (50270 - 12570) * 0.2;
  } else if (grossSalary > 50270) {
    incomeTax += (grossSalary - 50270) * 0.4;
    incomeTax += (50270 - 12570) * 0.2;
  } else if (grossSalary > 12570) {
    incomeTax += (grossSalary - 12570) * 0.2;
  }

  let nationalInsurance = 0;
  if (grossSalary > 50270) {
    nationalInsurance += (grossSalary - 50270) * 0.02;
    nationalInsurance += (50270 - 12570) * 0.08;
  } else if (grossSalary > 12570) {
    nationalInsurance += (grossSalary - 12570) * 0.08;
  }

  return {
    incomeTax: Math.round(incomeTax),
    nationalInsurance: Math.round(nationalInsurance),
    totalCentralContribution: Math.round(incomeTax + nationalInsurance),
    belowThreshold,
  };
}

// ---------------------------------------------------------------------------
// Spending data
// ---------------------------------------------------------------------------

const CENTRAL_SPENDING_BASE = [
  {
    category: "Social Protection", emoji: "🛡️", proportion: 0.274, color: "#4F86C6",
    description: "The largest single item in government spending — a safety net covering retirement, disability, unemployment and housing for millions.",
    details: [
      "State Pension ~£124bn — paid to 12.7 million pensioners, currently £221.20/week (full new state pension)",
      "Universal Credit & legacy benefits ~£65bn — income support for people in or out of work",
      "Personal Independence Payment (PIP) & disability ~£28bn — supports 3.4m people with long-term conditions",
      "Housing Benefit ~£23bn — rent support for low-income tenants, increasingly replaced by UC housing element",
      "Child Benefit & Working Tax Credit ~£19bn — paid to families with children regardless of income (tapered above £60k)",
      "Carer's Allowance ~£4bn — £81.90/week for people providing 35+ hours of unpaid care",
      "Bereavement benefits, maternity pay & statutory sick pay make up the remainder",
    ],
  },
  {
    category: "Health (NHS)", emoji: "🏥", proportion: 0.208, color: "#E05C5C",
    description: "Funds the entire National Health Service — free at point of use for all UK residents, one of the world's largest publicly funded health systems.",
    details: [
      "NHS England core budget ~£168bn — hospitals, A&E, elective surgery, specialist services",
      "GP & primary care ~£16bn — 340 million GP appointments per year",
      "Mental health services ~£16bn — talking therapies, inpatient wards, crisis teams (still underfunded vs need)",
      "NHS Scotland, Wales & Northern Ireland health budgets ~£20bn combined",
      "Medicines & prescriptions ~£10bn — England charges £9.90 per item; Scotland/Wales are free",
      "Public health & vaccinations ~£4bn — NHS flu jabs, childhood immunisations, cancer screening programmes",
      "Health research (NIHR) ~£1.5bn — funds clinical trials and medical research in NHS settings",
    ],
  },
  {
    category: "Education", emoji: "🎓", proportion: 0.098, color: "#6DBF67",
    description: "Covers schools from nursery to sixth form, universities, apprenticeships and adult skills — investing in the UK's workforce of the future.",
    details: [
      "School funding (ages 5–16) ~£58bn — National Funding Formula distributes money to ~24,000 schools",
      "Special Educational Needs & Disabilities (SEND) ~£10bn — one of the fastest-growing pressures on the system",
      "Higher Education & student loans ~£10bn — government writes off ~50% of student loans on average",
      "Further Education & skills ~£9bn — colleges, T-Levels, apprenticeship levy (paid by large employers)",
      "Early years & childcare ~£6bn — 15–30 free hours/week for 3–4 year olds; expanding to under-2s",
      "School breakfast clubs, pupil premium (£1,480 per disadvantaged pupil) and free school meals",
      "Research councils & Innovate UK ~£4bn — funds university research from physics to social sciences",
    ],
  },
  {
    category: "Debt Interest", emoji: "📉", proportion: 0.089, color: "#F0A500",
    description: "Interest on the UK's £2.6 trillion national debt — money that buys no services, employs nobody, and has more than doubled since 2021.",
    details: [
      "~£106bn/year in interest payments — larger than the entire defence budget",
      "UK national debt stands at ~100% of GDP, the highest since the 1960s",
      "~25% of UK debt is index-linked to RPI inflation — costs surged when inflation hit 11% in 2022",
      "Debt is owned by pension funds, insurance companies, overseas investors and the Bank of England",
      "Every 1% rise in interest rates adds ~£20bn to annual borrowing costs",
      "Every pound spent on interest is a pound not spent on hospitals, schools or roads",
      "The Office for Budget Responsibility forecasts interest costs to remain elevated until the 2030s",
    ],
  },
  {
    category: "Defence", emoji: "⚔️", proportion: 0.049, color: "#8B7EC8",
    description: "Funds the British Army, Royal Navy and Royal Air Force — personnel, equipment, nuclear deterrent, and the UK's NATO commitments.",
    details: [
      "~196,000 regular armed forces personnel plus ~37,000 reserves",
      "Equipment procurement ~£12bn — F-35B jets, Type 26 frigates, Ajax armoured vehicles, drones",
      "Trident nuclear deterrent ~£3bn/year — four Vanguard submarines maintain continuous at-sea deterrence",
      "Intelligence agencies: GCHQ, MI5 (domestic) and MI6 (overseas) — budgets classified but ~£3.5bn total",
      "NATO commitment: UK pledges 2.5% of GDP on defence by 2027, up from current 2.3%",
      "Veterans' pensions, mental health support and the Armed Forces Covenant",
      "Defence Science & Technology Laboratory (Dstl) — research into cyber, AI and future weapons",
    ],
  },
  {
    category: "Transport", emoji: "🚇", proportion: 0.038, color: "#4DBFBF",
    description: "Keeps Britain moving — railways, motorways, local roads, buses and the long-term infrastructure projects that shape the country for decades.",
    details: [
      "Network Rail / Great British Railways ~£10bn — track, signals, stations and train operating subsidies",
      "Road Investment Strategy ~£5bn/year — motorway upgrades, A-road dualling, junction improvements",
      "HS2 Phase 1 (Old Oak Common to Birmingham) — still under construction, budget now ~£67bn",
      "Transport for London (TfL) grants ~£1.5bn — supports the Tube, buses and Elizabeth line across Greater London",
      "Local transport capital grants — funding bus lanes, cycling infrastructure, pedestrian zones",
      "Bus Service Improvement Plans — government subsidy for unprofitable rural and evening routes",
      "Port and aviation infrastructure investment, active travel (walking & cycling) programmes",
    ],
  },
  {
    category: "Public Order & Safety", emoji: "👮", proportion: 0.034, color: "#E07B39",
    description: "Funds policing, the justice system and prisons — from neighbourhood beat officers to the Crown Court and the probation service.",
    details: [
      "Home Office police grants ~£14bn — funds 43 territorial police forces across England & Wales",
      "HM Prison & Probation Service ~£5bn — 121 prisons holding ~87,000 prisoners (near record capacity)",
      "Crown Prosecution Service & courts ~£4bn — processing ~1.7 million criminal cases per year",
      "Border Force & Immigration Enforcement — airports, ports, visa processing and removals",
      "National Crime Agency (NCA) — targeting organised crime, drug trafficking, child exploitation",
      "Counter-terrorism policing and MI5 domestic intelligence operations",
      "Legal Aid ~£2.2bn — funds defence lawyers and civil cases for those who cannot afford representation",
    ],
  },
  {
    category: "Housing & Environment", emoji: "🌳", proportion: 0.029, color: "#5BAD8F",
    description: "Building affordable homes, defending against floods, and funding the transition to net zero — investment in where and how we live.",
    details: [
      "Affordable Homes Programme (Homes England) ~£4bn — targets 1.5m new homes by 2029",
      "Environment Agency flood defences ~£1bn/year — protecting 314,000 properties from flooding",
      "Green Homes Grant successors — heat pump grants (£7,500), home insulation, solar incentives",
      "Social housing decarbonisation fund — improving EPC ratings in council and housing association stock",
      "Nature recovery & biodiversity net gain — 30×30 target to protect 30% of UK land by 2030",
      "Planning Reform — National Planning Policy Framework changes to unlock housing land",
      "Coastal erosion and water quality programmes (rivers and bathing waters)",
    ],
  },
  {
    category: "Business & Industry", emoji: "🏭", proportion: 0.028, color: "#C46CB0",
    description: "Supporting UK businesses to start, grow, export and innovate — from university spinouts to manufacturing investment and trade deals.",
    details: [
      "UK Research & Innovation (UKRI) ~£9bn — funds seven research councils plus Innovate UK grants",
      "British Business Bank — £13bn in finance to 97,000 smaller businesses (loans, equity, guarantees)",
      "Semiconductor Strategy — attracting chip design and manufacturing investment to the UK",
      "Freeports & Investment Zones — tax incentives in 12 designated areas including East Midlands and Teesside",
      "UK Export Finance (UKEF) — £8.5bn in guarantees helping UK firms win overseas contracts",
      "Industrial Strategy — long-term sector plans for clean energy, life sciences, creative industries and AI",
      "Competition & Markets Authority (CMA) — enforces competition law, reviews mergers including tech",
    ],
  },
  {
    category: "Foreign Affairs & Aid", emoji: "🌍", proportion: 0.013, color: "#7A9E7E",
    description: "Projecting British influence abroad — diplomacy, development assistance, the BBC World Service and contributions to international organisations.",
    details: [
      "Foreign Commonwealth & Development Office (FCDO) — 281 embassies, high commissions and consulates",
      "Official Development Assistance (ODA) — currently 0.5% GNI (~£15bn), down from 0.7% target",
      "Climate finance for developing nations — UK pledged £11.6bn 2021–2025 for clean energy transition",
      "British Council — English language teaching and cultural diplomacy in 100+ countries",
      "BBC World Service — reaches 492 million people weekly in 42 languages (part-funded by FCDO)",
      "United Nations assessed contributions — UK is 4th largest contributor to UN regular budget",
      "Peacekeeping operations — UK troops in Mali, Kosovo, Cyprus, South Sudan and elsewhere",
    ],
  },
  {
    category: "Everything Else", emoji: "📋", proportion: 0.14, color: "#AAB0B8",
    description: "Devolved block grants to Scotland, Wales and Northern Ireland, plus central administration, culture, digital and the institutions that run the state.",
    details: [
      "Scottish block grant ~£42bn (Barnett formula) — funds NHS Scotland, Scottish schools, policing",
      "Welsh block grant ~£19bn — funds NHS Wales, schools, transport and Welsh Government programmes",
      "Northern Ireland block grant ~£14bn — funds Stormont departments and public services",
      "HMRC administration ~£5bn — collects £900bn+ in taxes annually; funds 65,000 staff",
      "Department for Culture, Media & Sport — BBC (licence fee), arts (Arts Council), Sport England",
      "Cabinet Office & civil service reform — government efficiency, procurement, cyber security (NCSC)",
      "Parliamentary & electoral services — running Parliament, the Electoral Commission and referendums",
    ],
  },
];

const LOCAL_SPENDING_BASE = [
  {
    category: "Adult Social Care", emoji: "👴", proportion: 0.39, color: "#4F86C6",
    description: "The single biggest pressure on councils — supporting older people and disabled adults to live safely and with dignity. Demand is rising faster than funding.",
    details: [
      "Residential & nursing care placements — council funds those who cannot afford ~£1,200/week care home fees",
      "Home care packages — paid carers visiting people in their own homes (typically 3–4 visits/day)",
      "Direct Payments — cash given to disabled adults to arrange their own personal care and support",
      "Learning disability supported living — 24-hour support for people with complex needs in the community",
      "Mental health community support — step-down services, crisis housing, day centres",
      "Occupational therapy, equipment & adaptations (stairlifts, wet rooms, grab rails)",
      "Carer support services — respite breaks and advice for 6.5 million unpaid carers in England",
      "NHS-funded continuing healthcare — councils assess eligibility; NHS pays for those who qualify",
    ],
  },
  {
    category: "Children's Services", emoji: "👶", proportion: 0.2, color: "#E05C5C",
    description: "Protecting vulnerable children and supporting families — from early help to child protection, fostering and specialist education. Costs have risen 130% in a decade.",
    details: [
      "Child Protection investigations (Section 47) — triggered when abuse or neglect is suspected",
      "Looked-After Children — councils are 'corporate parent' to ~83,000 children in care in England",
      "Foster care payments — average £450/week per child; severe shortage of foster carers nationally",
      "Children's residential homes — for the most complex cases; can cost £250,000+ per child per year",
      "Child and Adolescent Mental Health Services (CAMHS) — 18-month average waits in many areas",
      "Early Help & family support — preventing cases escalating to child protection (saves money long-term)",
      "Youth Offending Teams — diverting young people from the criminal justice system",
      "Special Educational Needs (SEND) transport — councils legally required to fund transport to specialist schools",
    ],
  },
  {
    category: "Highways & Transport", emoji: "🛣️", proportion: 0.082, color: "#6DBF67",
    description: "Maintaining every road, pavement, bridge and street light that isn't a motorway or A-road — plus subsidising the bus routes that the market won't run.",
    details: [
      "Pothole repairs & road resurfacing — councils repair ~2 million potholes per year; backlog costs ~£16bn nationally",
      "Street lighting — councils own ~5 million street lights; increasingly switching to LED to cut energy costs",
      "Winter maintenance — gritting routes, snow clearance; a harsh winter can cost councils millions extra",
      "Traffic signals, pedestrian crossings & road markings — keeping junctions safe and flowing",
      "Pavement & footpath maintenance — legal duty to maintain; councils face claims for trip injuries",
      "Bus route subsidies — councils fund routes that commercial operators won't run (evenings, rural areas)",
      "Cycle lanes & active travel infrastructure — funded partly by central Active Travel England grants",
      "Bridge inspections and weight restrictions — structural maintenance of thousands of local bridges",
    ],
  },
  {
    category: "Environment & Waste", emoji: "♻️", proportion: 0.075, color: "#F0A500",
    description: "From your weekly bin collection to the parks your children play in — the visible, everyday services that define quality of life in a neighbourhood.",
    details: [
      "Residual waste collection — most councils collect black/grey bins fortnightly (landfill tax ~£103/tonne)",
      "Recycling collection — separate collections for paper, glass, plastics, food waste (varies by council)",
      "Household Waste Recycling Centres (tips) — councils under pressure to close sites to cut costs",
      "Street cleaning & litter enforcement — fixed penalty notices of £150 for littering",
      "Parks, play areas & open spaces — councils maintain ~27,000 parks and green spaces in England",
      "Tree maintenance — statutory duty; failure to maintain can lead to expensive legal claims",
      "Dog warden services & fly-tipping enforcement — fines up to £400 for fly-tipping",
      "Environmental health: noise complaints, pest control, contaminated land investigations",
    ],
  },
  {
    category: "Police Precept", emoji: "🚔", proportion: 0.061, color: "#8B7EC8",
    description: "Your council tax contributes directly to your local police force via the Police & Crime Commissioner — this is on top of the Home Office central police grant.",
    details: [
      "Funds your local Police & Crime Commissioner (PCC) — elected to hold the Chief Constable to account",
      "Neighbourhood policing teams — local beat officers, PCSOs and community engagement",
      "Response policing — officers attending 999 and 101 calls (response times vary widely by area)",
      "Criminal Investigation Departments (CID) — detectives handling serious and complex crimes",
      "Domestic Abuse & Violence Against Women & Girls (VAWG) units",
      "Road policing, firearms units, dogs and mounted sections",
      "The precept is separate from the national police grant — councils can raise it by up to 3% without a referendum",
      "Police workforce: ~149,000 officers in England & Wales, plus ~70,000 staff and 8,000 PCSOs",
    ],
  },
  {
    category: "Housing & Planning", emoji: "🏘️", proportion: 0.043, color: "#4DBFBF",
    description: "Tackling homelessness, managing planning applications, and making sure housing is safe and available — one of councils' most legally demanding responsibilities.",
    details: [
      "Homelessness prevention — councils have a legal 'prevention duty' to help anyone at risk of losing their home",
      "Temporary accommodation — councils spend ~£1.7bn/year housing families in B&Bs and hostels",
      "Housing advice service — debt counselling, tenant rights, help avoiding eviction",
      "Planning application processing — major developments, extensions, changes of use",
      "Building control & inspections — checking new builds meet fire safety and structural standards (post-Grenfell reforms)",
      "Housing register & allocation — managing waiting lists for social housing (1.3 million households waiting in England)",
      "Empty homes programmes — incentives and enforcement to bring vacant properties back into use",
      "Rough sleeper outreach & Housing First — getting people off the streets into permanent accommodation",
    ],
  },
  {
    category: "Culture, Sport & Libraries", emoji: "📚", proportion: 0.028, color: "#E07B39",
    description: "The services that make a place worth living in — public libraries, leisure centres, museums, arts and cultural venues. Frequently cut first when budgets are tight.",
    details: [
      "Public libraries — 2,700 libraries remain open in England; 800 have closed since 2010",
      "Library services: book loans, e-books, computers and internet access, job-search support, children's reading schemes",
      "Leisure centres & swimming pools — most are outsourced but councils subsidise access for low-income residents",
      "Museums & local heritage sites — from county museums to Roman remains and industrial heritage",
      "Arts grants & community festivals — small grants to local theatre companies, choirs, community events",
      "Allotment provision — councils have a statutory duty to provide allotments where demand exists",
      "Youth clubs & community centres — increasingly handed to voluntary sector or closed",
      "Public art, war memorials and civic spaces — maintenance of shared cultural infrastructure",
    ],
  },
  {
    category: "Fire & Rescue Precept", emoji: "🚒", proportion: 0.021, color: "#5BAD8F",
    description: "Funds your local Fire & Rescue Authority — the service that responds to fires, road crashes, floods and industrial incidents 24 hours a day.",
    details: [
      "50 Fire & Rescue Services in England — some run by councils, some by combined fire authorities",
      "~29,000 wholetime firefighters and ~17,000 on-call (retained) firefighters",
      "Fire stations, fire engines and specialist appliances (aerial platforms, rescue boats, water carriers)",
      "Fire investigation — determining cause and origin of fires, supporting criminal investigations",
      "Community fire safety — home fire safety visits, fitting free smoke alarms, school education visits",
      "Technical rescue — road traffic collisions, water rescue, industrial accidents, urban search & rescue",
      "Responding to flooding — pumping out flooded properties; increasingly busy due to climate change",
      "Fire Safety inspections of high-rise buildings — greatly expanded post-Grenfell Tower fire (2017)",
    ],
  },
  {
    category: "Other Council Services", emoji: "🏛️", proportion: 0.12, color: "#AAB0B8",
    description: "The wide range of statutory and discretionary services a council provides — from registering births to running elections to protecting consumers.",
    details: [
      "Register Office — births, deaths and marriages; 600,000+ births registered in England per year",
      "Electoral services — running local elections, maintaining the electoral register, postal vote processing",
      "Trading Standards — prosecuting rogue traders, counterfeit goods, underage sales enforcement",
      "Environmental Health — food hygiene inspections, noise complaints, private rented housing standards",
      "Licensing — pubs, nightclubs, taxis, HMOs, scrap metal dealers, sex establishments",
      "Coroner's service — investigating sudden, unexplained or violent deaths (legally required)",
      "Economic development — business support, market towns, town centre management, regeneration projects",
      "Democratic services — running full council meetings, scrutiny committees, planning committees",
    ],
  },
];

// ---------------------------------------------------------------------------
// Council tax lookup tables
// ---------------------------------------------------------------------------

const ENGLAND_COUNCIL_TAX: Record<string, { name: string; bandD: number }> = {
  "E09000001": { name: "City of London", bandD: 793 },
  "E09000002": { name: "Barking and Dagenham", bandD: 1770 },
  "E09000003": { name: "Barnet", bandD: 1618 },
  "E09000004": { name: "Bexley", bandD: 1786 },
  "E09000005": { name: "Brent", bandD: 1724 },
  "E09000006": { name: "Bromley", bandD: 1723 },
  "E09000007": { name: "Camden", bandD: 1402 },
  "E09000008": { name: "Croydon", bandD: 2041 },
  "E09000009": { name: "Ealing", bandD: 1760 },
  "E09000010": { name: "Enfield", bandD: 1834 },
  "E09000011": { name: "Greenwich", bandD: 1786 },
  "E09000012": { name: "Hackney", bandD: 1649 },
  "E09000013": { name: "Hammersmith and Fulham", bandD: 1395 },
  "E09000014": { name: "Haringey", bandD: 1871 },
  "E09000015": { name: "Harrow", bandD: 1882 },
  "E09000016": { name: "Havering", bandD: 1884 },
  "E09000017": { name: "Hillingdon", bandD: 1680 },
  "E09000018": { name: "Hounslow", bandD: 1716 },
  "E09000019": { name: "Islington", bandD: 1487 },
  "E09000020": { name: "Kensington and Chelsea", bandD: 1076 },
  "E09000021": { name: "Kingston upon Thames", bandD: 2034 },
  "E09000022": { name: "Lambeth", bandD: 1622 },
  "E09000023": { name: "Lewisham", bandD: 1771 },
  "E09000024": { name: "Merton", bandD: 1897 },
  "E09000025": { name: "Newham", bandD: 1558 },
  "E09000026": { name: "Redbridge", bandD: 1889 },
  "E09000027": { name: "Richmond upon Thames", bandD: 2096 },
  "E09000028": { name: "Southwark", bandD: 1476 },
  "E09000029": { name: "Sutton", bandD: 1990 },
  "E09000030": { name: "Tower Hamlets", bandD: 1238 },
  "E09000031": { name: "Waltham Forest", bandD: 1778 },
  "E09000032": { name: "Wandsworth", bandD: 876 },
  "E09000033": { name: "Westminster", bandD: 866 },
  "E08000001": { name: "Bolton", bandD: 2097 },
  "E08000002": { name: "Bury", bandD: 2103 },
  "E08000003": { name: "Manchester", bandD: 1809 },
  "E08000004": { name: "Oldham", bandD: 2182 },
  "E08000005": { name: "Rochdale", bandD: 2147 },
  "E08000006": { name: "Salford", bandD: 2205 },
  "E08000007": { name: "Stockport", bandD: 2012 },
  "E08000008": { name: "Tameside", bandD: 2122 },
  "E08000009": { name: "Trafford", bandD: 1914 },
  "E08000010": { name: "Wigan", bandD: 1946 },
  "E08000011": { name: "Knowsley", bandD: 2272 },
  "E08000012": { name: "Liverpool", bandD: 2235 },
  "E08000013": { name: "St Helens", bandD: 2107 },
  "E08000014": { name: "Sefton", bandD: 2167 },
  "E08000015": { name: "Wirral", bandD: 2248 },
  "E08000016": { name: "Barnsley", bandD: 2155 },
  "E08000017": { name: "Doncaster", bandD: 2026 },
  "E08000018": { name: "Rotherham", bandD: 2089 },
  "E08000019": { name: "Sheffield", bandD: 2034 },
  "E08000020": { name: "Gateshead", bandD: 2348 },
  "E08000021": { name: "Newcastle upon Tyne", bandD: 2307 },
  "E08000022": { name: "North Tyneside", bandD: 2167 },
  "E08000023": { name: "South Tyneside", bandD: 2412 },
  "E08000024": { name: "Sunderland", bandD: 2375 },
  "E08000025": { name: "Birmingham", bandD: 2128 },
  "E08000026": { name: "Coventry", bandD: 2101 },
  "E08000027": { name: "Dudley", bandD: 2008 },
  "E08000028": { name: "Sandwell", bandD: 2148 },
  "E08000029": { name: "Solihull", bandD: 1866 },
  "E08000030": { name: "Walsall", bandD: 2105 },
  "E08000031": { name: "Wolverhampton", bandD: 2062 },
  "E08000032": { name: "Bradford", bandD: 2145 },
  "E08000033": { name: "Calderdale", bandD: 2116 },
  "E08000034": { name: "Kirklees", bandD: 2062 },
  "E08000035": { name: "Leeds", bandD: 1924 },
  "E08000036": { name: "Wakefield", bandD: 2122 },
  "E06000023": { name: "Bristol", bandD: 2152 },
  "E06000014": { name: "York", bandD: 1950 },
  "E06000001": { name: "Hartlepool", bandD: 2414 },
  "E06000002": { name: "Middlesbrough", bandD: 2443 },
  "E06000003": { name: "Redcar and Cleveland", bandD: 2357 },
  "E06000004": { name: "Stockton-on-Tees", bandD: 2272 },
  "E06000005": { name: "Darlington", bandD: 2094 },
  "E06000010": { name: "Kingston upon Hull", bandD: 2228 },
  "E06000011": { name: "East Riding of Yorkshire", bandD: 1999 },
  "E06000012": { name: "North East Lincolnshire", bandD: 2002 },
  "E06000013": { name: "North Lincolnshire", bandD: 2010 },
  "E06000015": { name: "Derby", bandD: 2107 },
  "E06000016": { name: "Leicester", bandD: 2282 },
  "E06000017": { name: "Rutland", bandD: 2432 },
  "E06000018": { name: "Nottingham", bandD: 2478 },
  "E06000021": { name: "Stoke-on-Trent", bandD: 2088 },
  "E06000022": { name: "Telford and Wrekin", bandD: 1957 },
  "E06000030": { name: "Swindon", bandD: 1946 },
  "E06000031": { name: "Peterborough", bandD: 2087 },
  "E06000032": { name: "Luton", bandD: 2086 },
  "E06000033": { name: "Southend-on-Sea", bandD: 1981 },
  "E06000034": { name: "Thurrock", bandD: 1939 },
  "E06000035": { name: "Medway", bandD: 1951 },
  "E06000036": { name: "Bracknell Forest", bandD: 1820 },
  "E06000037": { name: "West Berkshire", bandD: 2002 },
  "E06000038": { name: "Reading", bandD: 2093 },
  "E06000039": { name: "Slough", bandD: 1701 },
  "E06000040": { name: "Windsor and Maidenhead", bandD: 1546 },
  "E06000041": { name: "Wokingham", bandD: 1867 },
  "E06000042": { name: "Milton Keynes", bandD: 2030 },
  "E06000043": { name: "Brighton and Hove", bandD: 2232 },
  "E06000044": { name: "Portsmouth", bandD: 2085 },
  "E06000045": { name: "Southampton", bandD: 2040 },
  "E06000046": { name: "Isle of Wight", bandD: 2244 },
  "E06000047": { name: "Durham", bandD: 2306 },
  "E06000049": { name: "Cheshire East", bandD: 1937 },
  "E06000050": { name: "Cheshire West and Chester", bandD: 1989 },
  "E06000051": { name: "Shropshire", bandD: 1999 },
  "E06000052": { name: "Cornwall", bandD: 2237 },
  "E06000053": { name: "Isles of Scilly", bandD: 1442 },
  "E06000054": { name: "Wiltshire", bandD: 2077 },
  "E06000055": { name: "Bedford", bandD: 2071 },
  "E06000056": { name: "Central Bedfordshire", bandD: 1962 },
  "E06000057": { name: "Northumberland", bandD: 2357 },
  "E06000058": { name: "Bournemouth Christchurch and Poole", bandD: 2182 },
  "E06000059": { name: "Dorset", bandD: 2203 },
  "E06000060": { name: "Buckinghamshire", bandD: 1899 },
  "E06000061": { name: "North Yorkshire", bandD: 2080 },
  "E06000062": { name: "Somerset", bandD: 2261 },
  "E10000002": { name: "Cambridgeshire", bandD: 2100 },
  "E10000003": { name: "Devon", bandD: 2200 },
  "E10000011": { name: "Essex", bandD: 1950 },
  "E10000012": { name: "Gloucestershire", bandD: 2050 },
  "E10000018": { name: "Kent", bandD: 1980 },
  "E10000019": { name: "Lancashire", bandD: 2100 },
  "E10000020": { name: "Leicestershire", bandD: 2000 },
  "E10000021": { name: "Lincolnshire", bandD: 2000 },
  "E10000023": { name: "Norfolk", bandD: 2100 },
  "E10000024": { name: "North Yorkshire (county)", bandD: 2050 },
  "E10000025": { name: "Nottinghamshire", bandD: 2100 },
  "E10000027": { name: "Oxfordshire", bandD: 2000 },
  "E10000028": { name: "Somerset (county)", bandD: 2200 },
  "E10000029": { name: "Suffolk", bandD: 2000 },
  "E10000030": { name: "Surrey", bandD: 1950 },
  "E10000031": { name: "Warwickshire", bandD: 2050 },
  "E10000034": { name: "West Sussex", bandD: 1980 },
  "E10000036": { name: "Worcestershire", bandD: 2050 },
};

const SCOTLAND_COUNCIL_TAX: Record<string, { name: string; bandD: number }> = {
  "S12000005": { name: "Clackmannanshire", bandD: 1438 },
  "S12000006": { name: "Dumfries and Galloway", bandD: 1408 },
  "S12000008": { name: "East Ayrshire", bandD: 1416 },
  "S12000010": { name: "East Lothian", bandD: 1442 },
  "S12000011": { name: "East Renfrewshire", bandD: 1358 },
  "S12000013": { name: "Na h-Eileanan Siar", bandD: 1202 },
  "S12000014": { name: "Falkirk", bandD: 1394 },
  "S12000015": { name: "Fife", bandD: 1451 },
  "S12000017": { name: "Highland", bandD: 1392 },
  "S12000018": { name: "Inverclyde", bandD: 1484 },
  "S12000019": { name: "Midlothian", bandD: 1515 },
  "S12000020": { name: "Moray", bandD: 1367 },
  "S12000021": { name: "North Ayrshire", bandD: 1494 },
  "S12000023": { name: "Orkney Islands", bandD: 1180 },
  "S12000024": { name: "Perth and Kinross", bandD: 1449 },
  "S12000026": { name: "Scottish Borders", bandD: 1420 },
  "S12000027": { name: "Shetland Islands", bandD: 1153 },
  "S12000028": { name: "South Ayrshire", bandD: 1424 },
  "S12000029": { name: "South Lanarkshire", bandD: 1407 },
  "S12000030": { name: "Stirling", bandD: 1468 },
  "S12000033": { name: "Aberdeen City", bandD: 1430 },
  "S12000034": { name: "Aberdeenshire", bandD: 1421 },
  "S12000035": { name: "Argyll and Bute", bandD: 1398 },
  "S12000036": { name: "Edinburgh", bandD: 1617 },
  "S12000038": { name: "Renfrewshire", bandD: 1431 },
  "S12000039": { name: "West Dunbartonshire", bandD: 1497 },
  "S12000040": { name: "West Lothian", bandD: 1471 },
  "S12000041": { name: "Angus", bandD: 1438 },
  "S12000042": { name: "Dundee City", bandD: 1510 },
  "S12000044": { name: "North Lanarkshire", bandD: 1473 },
  "S12000045": { name: "East Dunbartonshire", bandD: 1393 },
  "S12000046": { name: "Glasgow City", bandD: 1528 },
  "S12000049": { name: "Glasgow City", bandD: 1528 },
  "S12000050": { name: "North Lanarkshire", bandD: 1473 },
};

const WALES_COUNCIL_TAX: Record<string, { name: string; bandD: number }> = {
  "W06000001": { name: "Isle of Anglesey", bandD: 1672 },
  "W06000002": { name: "Gwynedd", bandD: 1841 },
  "W06000003": { name: "Conwy", bandD: 1821 },
  "W06000004": { name: "Denbighshire", bandD: 1887 },
  "W06000005": { name: "Flintshire", bandD: 1852 },
  "W06000006": { name: "Wrexham", bandD: 1888 },
  "W06000008": { name: "Ceredigion", bandD: 1963 },
  "W06000009": { name: "Pembrokeshire", bandD: 1677 },
  "W06000010": { name: "Carmarthenshire", bandD: 1813 },
  "W06000011": { name: "Swansea", bandD: 1924 },
  "W06000012": { name: "Neath Port Talbot", bandD: 2077 },
  "W06000013": { name: "Bridgend", bandD: 1949 },
  "W06000014": { name: "Vale of Glamorgan", bandD: 1926 },
  "W06000015": { name: "Cardiff", bandD: 1928 },
  "W06000016": { name: "Rhondda Cynon Taf", bandD: 2011 },
  "W06000018": { name: "Caerphilly", bandD: 1843 },
  "W06000019": { name: "Blaenau Gwent", bandD: 2087 },
  "W06000020": { name: "Torfaen", bandD: 1987 },
  "W06000021": { name: "Monmouthshire", bandD: 1818 },
  "W06000022": { name: "Newport", bandD: 1977 },
  "W06000023": { name: "Powys", bandD: 2004 },
  "W06000024": { name: "Merthyr Tydfil", bandD: 2107 },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  if (n < 10) return `£${n.toFixed(2)}`;
  return `£${Math.round(n).toLocaleString("en-GB")}`;
}

function lookupCouncil(gssCode: string, country: string): CouncilResult {
  if (country === "Northern Ireland") {
    return { bandD: 1149, authorityName: "Your council (Northern Ireland)" };
  }
  if (gssCode.startsWith("E")) {
    const entry = ENGLAND_COUNCIL_TAX[gssCode];
    return entry ? { bandD: entry.bandD, authorityName: entry.name } : { bandD: 2171, authorityName: "Your council (England)" };
  }
  if (gssCode.startsWith("S")) {
    const entry = SCOTLAND_COUNCIL_TAX[gssCode];
    return entry ? { bandD: entry.bandD, authorityName: entry.name } : { bandD: 1426, authorityName: "Your council (Scotland)" };
  }
  if (gssCode.startsWith("W")) {
    const entry = WALES_COUNCIL_TAX[gssCode];
    return entry ? { bandD: entry.bandD, authorityName: entry.name } : { bandD: 1931, authorityName: "Your council (Wales)" };
  }
  return { bandD: 2171, authorityName: "Your council" };
}

// ---------------------------------------------------------------------------
// SVG Donut Chart
// ---------------------------------------------------------------------------

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, innerR: number, outerR: number, startAngle: number, endAngle: number): string {
  const clampedEnd = Math.min(endAngle, startAngle + 359.99);
  const outerS = polarToCartesian(cx, cy, outerR, startAngle);
  const outerE = polarToCartesian(cx, cy, outerR, clampedEnd);
  const innerS = polarToCartesian(cx, cy, innerR, startAngle);
  const innerE = polarToCartesian(cx, cy, innerR, clampedEnd);
  const large = clampedEnd - startAngle > 180 ? 1 : 0;
  return [
    `M ${outerS.x} ${outerS.y}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${outerE.x} ${outerE.y}`,
    `L ${innerE.x} ${innerE.y}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${innerS.x} ${innerS.y}`,
    "Z",
  ].join(" ");
}

interface DonutChartProps {
  items: SpendingItem[];
  total: number;
  title: string;
}

function DonutChart({ items, total, title }: DonutChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const CX = 110;
  const CY = 110;
  const INNER_R = 54;
  const OUTER_R = 82;
  const OUTER_R_HOVER = 90;

  const slices = items.map((item, i) => {
    const start = items.slice(0, i).reduce((acc, it) => acc + it.proportion, 0) * 360;
    const end = start + item.proportion * 360;
    return { ...item, start, end, index: i };
  });

  const activeIndex = hovered ?? expanded ?? null;
  const activeItem = activeIndex !== null ? items[activeIndex] : null;
  const centerLabel = activeItem
    ? (activeItem.category.length > 14 ? activeItem.category.slice(0, 13) + "…" : activeItem.category)
    : "Total paid";
  const centerAmount = activeItem ? fmt(activeItem.userAmount) : fmt(total);

  const sorted = [...items].sort((a, b) => b.proportion - a.proportion);

  return (
    <div className="flex flex-col w-full gap-4">
      <p className="text-[10px] tracking-[0.25em] uppercase font-bold text-white/40">{title}</p>

      {/* On desktop: chart left + legend right. On mobile: chart top, legend below */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-5 w-full">

        {/* SVG donut */}
        <div className="flex-shrink-0 flex justify-center sm:justify-start" style={{ width: "min(220px, 100%)" }}>
          <svg width="220" height="220" viewBox="0 0 220 220" style={{ width: "100%", height: "auto" }}>
            {slices.map((s) => {
              const isActive = hovered === s.index || (hovered === null && expanded === s.index);
              const outerR = isActive ? OUTER_R_HOVER : OUTER_R;
              return (
                <path
                  key={s.index}
                  d={arcPath(CX, CY, INNER_R, outerR, s.start, s.end)}
                  fill={s.color}
                  opacity={activeIndex !== null && !isActive ? 0.45 : 1}
                  style={{ transition: "opacity 150ms" }}
                  onMouseEnter={() => setHovered(s.index)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => setExpanded(prev => prev === s.index ? null : s.index)}
                  cursor="pointer"
                />
              );
            })}
            <text x={CX} y={CY - 8} textAnchor="middle" fill="rgba(245,245,245,0.4)" fontSize="9.5" fontFamily="var(--font-manrope)">
              {centerLabel}
            </text>
            <text x={CX} y={CY + 13} textAnchor="middle" fill="#FFBF00" fontSize="19" fontWeight="700" fontFamily="var(--font-jakarta)">
              {centerAmount}
            </text>
          </svg>
        </div>

        {/* Legend */}
        <div className="flex flex-col gap-0.5 w-full min-w-0">
          {sorted.map((item) => {
            const origIndex = items.indexOf(item);
            const isH = hovered === origIndex;
            const isE = expanded === origIndex;
            return (
              <div key={item.category}>
                {/* Row */}
                <div
                  className="flex items-start gap-2.5 cursor-pointer rounded-xl px-3 py-2.5 transition-colors select-none"
                  style={{ background: isH || isE ? "rgba(255,255,255,0.06)" : "transparent" }}
                  onMouseEnter={() => setHovered(origIndex)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => setExpanded(prev => prev === origIndex ? null : origIndex)}
                >
                  <span className="flex-shrink-0 w-2.5 h-2.5 rounded-full mt-[3px]" style={{ background: item.color }} />
                  <span className="flex-1 text-[13px] text-white/80 leading-snug min-w-0">
                    {item.emoji} {item.category}
                  </span>
                  <span className="text-[11px] text-white/35 tabular-nums flex-shrink-0 pt-px">{(item.proportion * 100).toFixed(1)}%</span>
                  <span className="text-[13px] font-semibold text-amber-400 tabular-nums flex-shrink-0 w-[3.5rem] text-right">{fmt(item.userAmount)}</span>
                  <span className="text-white/30 text-[10px] flex-shrink-0 pt-px">{isE ? "▲" : "▼"}</span>
                </div>

                {/* Expandable detail panel */}
                <AnimatePresence>
                  {isE && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div
                        className="mx-2 mb-1 rounded-xl px-4 py-4 space-y-4"
                        style={{
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        {/* Your contribution strip */}
                        <div className="flex flex-wrap gap-x-5 gap-y-2 pb-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                          <div>
                            <p className="text-[9px] tracking-[0.2em] uppercase text-white/30 mb-0.5">Your contribution / year</p>
                            <p className="text-base font-bold text-amber-400">{fmt(item.userAmount)}</p>
                          </div>
                          <div>
                            <p className="text-[9px] tracking-[0.2em] uppercase text-white/30 mb-0.5">Per month</p>
                            <p className="text-base font-bold text-white/60">{fmt(item.userAmount / 12)}</p>
                          </div>
                          <div>
                            <p className="text-[9px] tracking-[0.2em] uppercase text-white/30 mb-0.5">Per week</p>
                            <p className="text-base font-bold text-white/60">{fmt(item.userAmount / 52)}</p>
                          </div>
                        </div>

                        {/* Description */}
                        <p className="text-[12px] text-white/60 leading-relaxed">{item.description}</p>

                        {/* Detail bullets */}
                        <ul className="space-y-2">
                          {item.details.map((d, i) => (
                            <li key={i} className="flex gap-2 items-start">
                              <span className="flex-shrink-0 mt-[5px] w-1.5 h-1.5 rounded-full" style={{ background: item.color }} />
                              <span className="text-[12px] text-white/55 leading-relaxed">{d}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4 flex flex-col gap-1.5">
      <p className="text-[9px] tracking-[0.3em] uppercase font-bold text-white/40 leading-tight">{label}</p>
      <p className="text-xl sm:text-2xl font-bold font-display text-amber-400 leading-none">{value}</p>
      {sub && <p className="text-[11px] text-white/40 leading-snug">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

function SkeletonRow() {
  return (
    <div className="flex gap-4 flex-wrap">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="card p-4 flex-1 min-w-[140px] animate-pulse">
          <div className="h-2 bg-white/10 rounded mb-3 w-2/3" />
          <div className="h-6 bg-white/10 rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TaxBreakdownPage() {
  const [salary, setSalary] = useState("");
  const [postcode, setPostcode] = useState("");
  const [loading, setLoading] = useState(false);
  const [postcodeError, setPostcodeError] = useState("");
  const [salaryError, setSalaryError] = useState("");
  const [result, setResult] = useState<PageResult | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const handleCalculate = useCallback(async () => {
    // Validate
    const salaryNum = parseFloat(salary.replace(/,/g, ""));
    if (!salary || isNaN(salaryNum) || salaryNum < 0) {
      setSalaryError("Please enter a valid yearly salary");
      return;
    }
    setSalaryError("");
    if (!postcode.trim()) {
      setPostcodeError("Please enter your postcode");
      return;
    }
    setPostcodeError("");
    setLoading(true);

    try {
      const clean = postcode.replace(/\s/g, "").toUpperCase();
      const res = await fetch(`https://api.postcodes.io/postcodes/${clean}`);
      if (!res.ok) {
        setPostcodeError("Please enter a valid UK postcode");
        setLoading(false);
        return;
      }
      const json = await res.json();
      const { result: pc } = json;
      const gssCode: string = pc?.codes?.admin_district ?? "";
      const country: string = pc?.country ?? "";
      const adminDistrict: string = pc?.admin_district ?? "";

      const council = lookupCouncil(gssCode, country);
      if (adminDistrict && council.authorityName.startsWith("Your council")) {
        council.authorityName = adminDistrict;
      }

      const tax = calculateTax(salaryNum);

      const centralItems: SpendingItem[] = CENTRAL_SPENDING_BASE.map((b) => ({
        ...b,
        userAmount: Math.round(tax.totalCentralContribution * b.proportion),
      }));

      const localItems: SpendingItem[] = LOCAL_SPENDING_BASE.map((b) => ({
        ...b,
        userAmount: Math.round(council.bandD * b.proportion),
      }));

      setResult({ tax, council, centralItems, localItems });

      // Scroll to results after render
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch {
      setPostcodeError("Unable to look up postcode. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [salary, postcode]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleCalculate();
    },
    [handleCalculate]
  );

  return (
    <div
      className="min-h-screen w-full px-4 py-12 md:px-8"
      style={{ background: "rgba(6,6,22,0.97)" }}
    >
      <div className="max-w-5xl mx-auto space-y-10 pb-24">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="space-y-2"
        >
          <p className="text-[9px] tracking-[0.3em] uppercase font-bold text-amber-400/70">Nexo Tax Tool</p>
          <h1 className="text-3xl md:text-4xl font-display font-bold text-white leading-tight">
            Where your taxes go
          </h1>
          <p className="text-white/50 text-sm max-w-xl">
            Enter your salary and postcode to see exactly how your money is spent — nationally and locally.
          </p>
        </motion.div>

        {/* Input form */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.08 }}
          className="card p-6 space-y-4"
        >
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Salary */}
            <div className="flex-1 space-y-1">
              <label className="text-[9px] tracking-[0.3em] uppercase font-bold text-white/40 block">
                Yearly gross salary (£)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm font-semibold">£</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={salary}
                  onChange={(e) => { setSalary(e.target.value); setSalaryError(""); }}
                  onKeyDown={handleKeyDown}
                  placeholder="35000"
                  className="w-full pl-7 pr-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none border transition-colors"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: salaryError ? "1px solid #FF5A6A" : "1px solid rgba(255,255,255,0.08)",
                  }}
                />
              </div>
              <AnimatePresence>
                {salaryError && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-[11px] text-red-400"
                  >
                    {salaryError}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            {/* Postcode */}
            <div className="flex-1 space-y-1">
              <label className="text-[9px] tracking-[0.3em] uppercase font-bold text-white/40 block">
                UK postcode
              </label>
              <input
                type="text"
                value={postcode}
                onChange={(e) => { setPostcode(e.target.value); setPostcodeError(""); }}
                onKeyDown={handleKeyDown}
                placeholder="SW1A 2AA"
                autoCapitalize="characters"
                className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none border transition-colors uppercase"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: postcodeError ? "1px solid #FF5A6A" : "1px solid rgba(255,255,255,0.08)",
                }}
              />
              <AnimatePresence>
                {postcodeError && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-[11px] text-red-400"
                  >
                    {postcodeError}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            {/* Button — aligned to bottom of inputs */}
            <div className="flex items-end">
              <button
                onClick={handleCalculate}
                disabled={loading}
                className="btn-primary w-full sm:w-auto whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? "Looking up…" : "Calculate"}
              </button>
            </div>
          </div>
        </motion.div>

        {/* Loading skeleton */}
        <AnimatePresence>
          {loading && (
            <motion.div
              key="skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <SkeletonRow />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card p-6 animate-pulse h-80" />
                <div className="card p-6 animate-pulse h-80" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results */}
        <AnimatePresence>
          {result && !loading && (
            <motion.div
              key="results"
              ref={resultRef}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="space-y-8"
            >

              {/* Below-threshold notice */}
              {result.tax.belowThreshold && (
                <div
                  className="rounded-xl p-4 text-sm text-amber-300 border"
                  style={{ background: "rgba(255,191,0,0.06)", borderColor: "rgba(255,191,0,0.18)" }}
                >
                  Your salary is below the £12,570 personal allowance threshold — no income tax or National Insurance is due.
                </div>
              )}

              {/* Section A — Your Contribution */}
              <div className="space-y-3">
                <p className="text-[9px] tracking-[0.3em] uppercase font-bold text-white/40">Your contribution</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatCard
                    label="Income Tax"
                    value={fmt(result.tax.incomeTax)}
                    sub="Per year"
                  />
                  <StatCard
                    label="National Insurance"
                    value={fmt(result.tax.nationalInsurance)}
                    sub="Per year"
                  />
                  <StatCard
                    label="Total — Central Govt"
                    value={fmt(result.tax.totalCentralContribution)}
                    sub="Income tax + NI combined"
                  />
                  <StatCard
                    label={`Council Tax — Band D`}
                    value={fmt(result.council.bandD)}
                    sub={result.council.authorityName}
                  />
                </div>
              </div>

              {/* Section B — Donut charts */}
              <div className="space-y-3">
                <p className="text-[9px] tracking-[0.3em] uppercase font-bold text-white/40">Your tax split</p>
                <div className="flex flex-col gap-6">
                  <div className="card p-6">
                    <DonutChart
                      items={result.centralItems}
                      total={result.tax.totalCentralContribution}
                      title="National spending (income tax + NI)"
                    />
                  </div>
                  <div className="card p-6">
                    <DonutChart
                      items={result.localItems}
                      total={result.council.bandD}
                      title="Local council spending (council tax)"
                    />
                  </div>
                </div>
              </div>

              {/* Section C — Disclaimer */}
              <p className="text-[11px] text-white/30 leading-relaxed max-w-3xl">
                Figures are estimates based on Band D council tax and are proportional to published HM Treasury PESA 2023/24
                and DLUHC 2024/25 data. postcodes.io used for postcode lookup. Individual council tax bills depend on property
                band and applicable discounts.
              </p>

            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
