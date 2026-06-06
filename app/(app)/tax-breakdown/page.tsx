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
  { category: "Social Protection", emoji: "🛡️", description: "State pension, universal credit, housing benefit, disability benefits", proportion: 0.274, color: "#4F86C6" },
  { category: "Health (NHS)", emoji: "🏥", description: "NHS England/Scotland/Wales, public health, health research", proportion: 0.208, color: "#E05C5C" },
  { category: "Education", emoji: "🎓", description: "Schools, universities, skills and further education", proportion: 0.098, color: "#6DBF67" },
  { category: "Debt Interest", emoji: "📉", description: "Interest payments on national debt", proportion: 0.089, color: "#F0A500" },
  { category: "Defence", emoji: "⚔️", description: "Armed forces, equipment, military personnel", proportion: 0.049, color: "#8B7EC8" },
  { category: "Transport", emoji: "🚇", description: "Roads, rail, local transport grants", proportion: 0.038, color: "#4DBFBF" },
  { category: "Public Order & Safety", emoji: "👮", description: "Police, courts, prisons, fire services", proportion: 0.034, color: "#E07B39" },
  { category: "Housing & Environment", emoji: "🌳", description: "Social housing, planning, flood defences, green energy", proportion: 0.029, color: "#5BAD8F" },
  { category: "Business & Industry", emoji: "🏭", description: "Science, innovation, trade, enterprise support", proportion: 0.028, color: "#C46CB0" },
  { category: "Foreign Affairs & Aid", emoji: "🌍", description: "Diplomacy, overseas development assistance", proportion: 0.013, color: "#7A9E7E" },
  { category: "Everything Else", emoji: "📋", description: "Central government admin, culture, sport, devolved block grants", proportion: 0.14, color: "#AAB0B8" },
];

const LOCAL_SPENDING_BASE = [
  { category: "Adult Social Care", emoji: "👴", description: "Care homes, home care, disability support for adults", proportion: 0.39, color: "#4F86C6" },
  { category: "Children's Services", emoji: "👶", description: "Child protection, fostering, youth services", proportion: 0.2, color: "#E05C5C" },
  { category: "Highways & Transport", emoji: "🛣️", description: "Road maintenance, street lighting, public transport support", proportion: 0.082, color: "#6DBF67" },
  { category: "Environment & Waste", emoji: "♻️", description: "Rubbish collection, recycling, parks, street cleaning", proportion: 0.075, color: "#F0A500" },
  { category: "Police Precept", emoji: "🚔", description: "Local police force contribution", proportion: 0.061, color: "#8B7EC8" },
  { category: "Housing & Planning", emoji: "🏘️", description: "Homelessness support, planning services, housing strategy", proportion: 0.043, color: "#4DBFBF" },
  { category: "Culture, Sport & Libraries", emoji: "📚", description: "Libraries, leisure centres, arts and cultural venues", proportion: 0.028, color: "#E07B39" },
  { category: "Fire & Rescue Precept", emoji: "🚒", description: "Local fire and rescue services", proportion: 0.021, color: "#5BAD8F" },
  { category: "Other Council Services", emoji: "🏛️", description: "Registrars, trading standards, economic development", proportion: 0.12, color: "#AAB0B8" },
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
        <div className="flex-shrink-0 flex justify-center sm:justify-start">
          <svg width="220" height="220" viewBox="0 0 220 220">
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
                  className="flex items-center gap-2.5 cursor-pointer rounded-xl px-3 py-2 transition-colors select-none"
                  style={{ background: isH || isE ? "rgba(255,255,255,0.06)" : "transparent" }}
                  onMouseEnter={() => setHovered(origIndex)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => setExpanded(prev => prev === origIndex ? null : origIndex)}
                >
                  <span className="flex-shrink-0 w-2.5 h-2.5 rounded-full" style={{ background: item.color }} />
                  <span className="flex-1 text-[13px] text-white/75 leading-tight min-w-0 truncate">
                    {item.emoji} {item.category}
                  </span>
                  <span className="text-[11px] text-white/35 tabular-nums flex-shrink-0">{(item.proportion * 100).toFixed(1)}%</span>
                  <span className="text-[13px] font-semibold text-amber-400 tabular-nums flex-shrink-0 w-14 text-right">{fmt(item.userAmount)}</span>
                  <span className="text-white/25 text-[10px] flex-shrink-0">{isE ? "▲" : "▼"}</span>
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
                        className="mx-2 mb-1 rounded-xl px-4 py-3 space-y-3"
                        style={{
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        {/* Description */}
                        <p className="text-[12px] text-white/55 leading-relaxed">{item.description}</p>

                        {/* Per-period breakdown */}
                        <div className="flex gap-4">
                          <div>
                            <p className="text-[9px] tracking-[0.2em] uppercase text-white/30 mb-0.5">Per year</p>
                            <p className="text-sm font-bold text-amber-400">{fmt(item.userAmount)}</p>
                          </div>
                          <div>
                            <p className="text-[9px] tracking-[0.2em] uppercase text-white/30 mb-0.5">Per month</p>
                            <p className="text-sm font-bold text-white/60">{fmt(item.userAmount / 12)}</p>
                          </div>
                          <div>
                            <p className="text-[9px] tracking-[0.2em] uppercase text-white/30 mb-0.5">Per week</p>
                            <p className="text-sm font-bold text-white/60">{fmt(item.userAmount / 52)}</p>
                          </div>
                        </div>
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
    <div className="card p-4 flex flex-col gap-1">
      <p className="text-[9px] tracking-[0.3em] uppercase font-bold text-white/40">{label}</p>
      <p className="text-2xl font-bold font-display text-amber-400 leading-none">{value}</p>
      {sub && <p className="text-[11px] text-white/40 leading-snug mt-0.5">{sub}</p>}
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
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
