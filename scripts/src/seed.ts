import { db, sectionsTable, sectionVersionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const SECTIONS_DATA = [
  {
    slug: "executive-overview",
    title: "Executive Overview",
    description: "A high-level summary of AI adoption in Hong Kong's marketing industry",
    displayOrder: 1,
    body: `Artificial intelligence has crossed from experiment to operational reality inside Hong Kong's marketing and advertising industry. The city's marketing ecosystem is now defined by a striking paradox: headline adoption numbers have never been higher, yet the majority of organisations still sit in the early or limited-implementation stages of their AI journey — capturing localised productivity gains without achieving the transformational, revenue-generating outcomes that AI promises.

According to the Hong Kong Productivity Council's (HKPC) AI Readiness in Workplace Survey 2025, **88% of employees** in surveyed companies have already used AI tools in their day-to-day work, with marketing singled out as one of the three primary application areas alongside customer service and data analysis. The Deloitte–HKU AI Adoption Index 2026 places marketing as the **second most AI-adopted business function at 54%**, just behind customer service (58%). Yet the same study finds that only **23% of organisations report measurable financial impact** from AI, and a mere **4% have reached a truly transformational stage**.

A parallel finding from Twilio's research reveals what has been termed the **"AI expectation gap"**: 87% of Hong Kong brands now use AI to personalise customer experiences, but only 42% of local consumers agree that brands are successfully delivering on that promise. This gap — between technological deployment and felt customer experience — is the defining challenge for Hong Kong marketers in 2026. Bridging it will require moving beyond tool adoption and toward disciplined, data-grounded AI strategy.

### Key Headline Findings

- Total Hong Kong advertising spend reached **HK$33.9 billion** in 2025, with social media (+15% YOY) leading all channels.
- The Hong Kong generative AI market is projected to grow at a **35.5% CAGR**, reaching **USD 21.05 billion** by 2033.
- Internet advertising revenue in Hong Kong was valued at **US$1.8 billion** in 2024, projected to reach **US$2.6 billion** by 2029 at a 7.4% CAGR.
- Talent shortage is the single biggest barrier to AI scaling, with AI professionals commanding **20–40% wage premiums**.
- The government has formally designated AI a "pillar industry" and allocated **HK$50 million** for public AI education and upskilling.`,
    insights: [
      "88% of employees in surveyed companies already use AI tools daily, but only 4% of organisations have reached transformational AI maturity",
      "The 'AI expectation gap': 87% of brands use AI for personalisation, but only 42% of consumers feel it's working",
      "Hong Kong's generative AI market projected to reach USD 21.05 billion by 2033 at 35.5% CAGR",
      "Total ad spend reached HK$33.9 billion in 2025, with social media leading at +15% YOY growth"
    ],
  },
  {
    slug: "market-context",
    title: "Market Context and Macroeconomic Backdrop",
    description: "Hong Kong's advertising market transition and digital infrastructure",
    displayOrder: 2,
    body: `## Hong Kong's Advertising Market in Transition

Hong Kong's advertising market navigated turbulent conditions in 2025. Total ad spend declined modestly across the first three quarters of the year — weighed down by shifting consumer behaviour, Hongkongers spending more time and money north of the border, and lingering macroeconomic caution — before a notable **5% YOY rebound in Q4**. Full-year spend settled at **HK$33.9 billion**, according to admanGo's latest data. The year's trajectory confirms a structural shift already underway: the industry is migrating from broad, analogue reach toward precision digital and social channels that are increasingly AI-enabled.

**Social media** has emerged as the dominant medium, recording the strongest channel performance with a **15% YOY increase in adspend** in 2025, with Instagram posting the category's highest single growth rate at **35% YOY**. Mobile, television, and search engine marketing ranked second through fourth. This shift reflects a fundamental change in how Hong Kong audiences — **93.7% of whom access the internet via mobile devices** — discover and engage with brands.

Video advertising is the fastest-growing internet advertising segment, with a projected CAGR of **8.5% through 2029**, expected to account for **29.3% of the online advertising market** by that year.

## The Macro-Digital Foundation

Hong Kong's digital infrastructure provides a strong foundation for AI-powered marketing. The city's smartphone penetration exceeds **96.3%**, among the highest globally, creating near-universal addressability for data-driven campaigns. The government's Smart City Blueprint and its push for full-scale 5G adoption are enabling faster real-time data collection and more sophisticated programmatic capabilities.

The Hong Kong Generative AI market was valued at **USD 1.85 billion** in 2024 and is projected to reach **USD 21.05 billion** by 2033, reflecting a CAGR of 35.5%. The AI for customer service segment alone is expected to grow from **USD 210 million** in 2024 to **USD 2.1 billion** by 2033, at a 33.2% CAGR, driven by demand for personalised, multilingual, 24/7 service across Cantonese, English, and Mandarin.

Hong Kong's position as an international financial hub, gateway to the Greater Bay Area (GBA), and a city with a highly educated, bilingual workforce creates a uniquely favourable environment for AI-powered marketing at scale. The city ranked **18th in the Global Innovation Index 2024**, reinforcing its standing as a regional technology leader.`,
    insights: [
      "Social media ad spend grew 15% YOY in 2025, with Instagram at 35% YOY — the fastest-growing channel",
      "93.7% of Hong Kong internet users access via mobile, enabling near-universal data-driven campaign addressability",
      "HK generative AI market valued at USD 1.85B in 2024, projected to reach USD 21.05B by 2033",
      "Video advertising growing at 8.5% CAGR, expected to reach 29.3% of online ad market by 2029"
    ],
  },
  {
    slug: "adoption-levels",
    title: "Adoption Levels in Hong Kong Marketing Teams",
    description: "Headline adoption data, functional breakdown, and the skills gap",
    displayOrder: 3,
    body: `## Headline Adoption Data

Hong Kong's marketing industry has moved well past the experimentation phase, but the distribution of adoption is uneven. The most comprehensive cross-industry picture comes from three landmark surveys conducted in 2025–2026.

The **HKPC AI Readiness in Workplace Survey 2025**, drawing on interviews with approximately 800 local companies, found that 88% of employees in surveyed organisations already use AI tools in their daily work, predominantly in customer service, data analysis, and marketing. A remarkable **92% of respondents plan to gradually introduce AI into formal workflows**, with 24% targeting full implementation within one year. However, a governance gap is already visible: while 45% of enterprises have officially recognised AI platforms, **more than half (54%) do not yet have a complete AI governance framework**.

The **Deloitte–HKU AI Adoption Index 2026** found AI adoption highest in customer service (58%), marketing (54%), and IT/technology (53%). Despite this, the maturity picture tells a sobering story: **56% of organisations remain in "limited implementation"** with only localised benefits; 23% report measurable financial impact; and a mere **4% have reached the transformational stage**.

The **PwC Hong Kong Workforce Hopes and Fears Survey 2025** adds a workforce lens: **61% of workers in Hong Kong are leveraging AI tools at work**, ahead of the global average of 54%.

## Functional Breakdown of AI Use in Marketing

| AI Use Case | Adoption Rate (2025) | Trend |
|---|---|---|
| Internal automation / performance insights | ~27% | ▲ Growth |
| Content creation (copy, visuals, assets) | 26% | ▲ Notable growth |
| Chatbots and customer service automation | ~24% | Stable |
| Customer segmentation / scoring | 15% | ▼ Slight decline |
| Marketing Mix Modelling | ~8% | Low / flat |
| No AI use case deployed | ~33% | ▼ Small decrease |

## The Skills Gap

Talent development represents the most acute operational challenge. The HKPC survey identifies **lack of AI expertise and training as the single biggest hurdle** to AI rollout across Hong Kong enterprises. AI professionals command **20–40% wage premiums** in the current market, and only **1 in 4 companies has a structured AI implementation plan**.

A Salesforce global survey echoes this locally: **70% of marketers say their employer does not provide AI training**, while 39% avoid generative AI due to safety uncertainty and 43% struggle to extract real business value from the tools they do use.

HKPC Academy has trained approximately **22,000 people in AI-related skills** over the past two years through more than 500 activities.`,
    insights: [
      "56% of organisations remain in 'limited implementation' — only 4% have achieved transformational AI use",
      "Content creation is the fastest-growing AI use case at 26% adoption, driven by generative AI accessibility",
      "70% of marketers say their employer provides no AI training — the single biggest barrier to scaling",
      "AI professionals command 20–40% wage premiums; only 1 in 4 companies has a structured AI plan"
    ],
  },
  {
    slug: "use-cases",
    title: "Use Cases and Case Studies",
    description: "Local brands and agencies deploying AI in Hong Kong marketing",
    displayOrder: 4,
    body: `## Financial Services: Leading the Way

Hong Kong's financial services sector has produced the most sophisticated documented examples of AI in marketing, setting templates that agencies and brands across sectors are beginning to follow.

**HSBC Hong Kong** launched **Communication Amplifier** in late 2024 — an internally developed generative AI platform designed to produce marketing content aligned with the bank's tone of voice, compliance requirements, and business objectives. The tool reduces manual drafting time, improves consistency across channels, and allows teams to scale content production without compromising governance. The initiative earned the **Best Gen-AI Initiative award** at The Digital Banker's Global Retail Banking Innovations Awards 2025.

The bank's **WealthSignal Engine** extends AI further into marketing by drawing on approximately **2,000 data points per customer** to generate actionable insights for relationship managers. HSBC is reported to be evaluating more than **100 use cases for generative AI** across its Hong Kong operations.

**Standard Chartered Bank (Hong Kong)** and **dentsu Hong Kong** delivered the award-winning "In Times of Need" campaign, which used 1st-party data pool analytics combined with a real-time interaction management (RTIM) decision engine to predict and deliver the "next best action" for individual customers.

**Hang Seng Bank's** partnership with VML Hong Kong produced the **Hazel AI-powered brand campaigns**, deploying an AI-powered branded conversational agent.

## Aviation and Travel

**Cathay Pacific** has emerged as one of Hong Kong's most AI-forward marketing organisations. The airline's Cathay Pacific Media-Active Ecology campaign, executed with **Digitas Hong Kong**, won Gold for Best Use of Performance Marketing at the IAB HK Digital Awards 2024. Cathay Pacific is reportedly reducing marketing and administrative staff as part of a broader initiative to fund AI investments, with a target of reducing administrative costs by **20% by end-2030**.

## Healthcare and Insurance

**Bupa and DigiSalad** claimed the top honour at the IAB HK Digital Awards 2024 — **Best Digital Campaign of the Year** — for their AI-powered "Together For Your Health & Connected Care Expo – Blua Health Mobile App" campaign.

## Retail and FMCG

**Asahi** (with dentsu Hong Kong and The Trade Desk) deployed programmatic AI across its Dry Crystal launch campaign. **Ocean Park Hong Kong** partnered with EternityX Marketing Technology to run KOL campaigns on Xiaohongshu and Douyin targeting GBA tourists using data-driven analysis.`,
    insights: [
      "HSBC's Communication Amplifier: generative AI platform for compliant marketing content at scale, won Best Gen-AI Initiative",
      "Standard Chartered's RTIM engine predicts 'next best action' for individual customers using 1st-party data",
      "Cathay Pacific targeting 20% admin cost reduction by 2030 through AI, restructuring marketing roles",
      "Bupa & DigiSalad won Best Digital Campaign of the Year for AI-powered health engagement"
    ],
  },
  {
    slug: "tools-platforms",
    title: "Tools and Platforms Landscape",
    description: "Global AI tools, martech stacks, and local providers in Hong Kong",
    displayOrder: 5,
    body: `## Global AI Tools in Local Use

The Hong Kong marketing industry draws predominantly from the same global toolset as its regional peers, with selection driven by existing enterprise relationships, agency holding-company agreements, and specific use-case requirements.

**ChatGPT (OpenAI)** dominates as the most widely used AI content tool, with **90% usage** among marketers globally who have adopted AI. In Hong Kong's agency and brand environments, ChatGPT is used for brainstorming, copy drafting, social media caption generation, and brief preparation.

**Adobe Firefly** has gained rapid traction among creative agencies and in-house design teams for image generation, text effects, and vector creation within the Creative Cloud ecosystem.

For media and programmatic, **The Trade Desk** and **Google DV360** are the dominant demand-side platforms deployed by Hong Kong agencies, both with embedded AI-driven bidding, audience prediction, and creative optimisation.

**EternityX Marketing Technology** offers a HK-headquartered platform specifically designed for cross-border marketing targeting mainland Chinese audiences via XHS, Douyin, WeChat, and other platforms, with AI at its core for KOL selection and audience analytics.

## Martech Stack Architecture

The most sophisticated Hong Kong marketing operations are now built around **Customer Data Platforms (CDPs)** and real-time interaction management engines. Over **40% of Hong Kong organisations** have now implemented robust data governance frameworks — a prerequisite for meaningful AI marketing.

## Local AI Providers

**SenseTime**, founded in Hong Kong in 2014, is a significant local AI technology provider. Its SenseNova large model system underpins **Sensechat**, a Cantonese AI assistant with deep understanding of Hong Kong's local culture, customs, and Cantonese linguistic nuances.

| Category | Key Platforms |
|---|---|
| Generative AI (content) | ChatGPT, Adobe Firefly, Claude, Google Gemini |
| Programmatic & Media | The Trade Desk, Google DV360, Adzymic |
| Martech & CDP | Adobe Experience Cloud, SAP Emarsys, Salesforce Marketing Cloud |
| Cross-border / GBA | EternityX, Tencent Marketing, ByteDance, XHS Ads |
| Data & Analytics | fifty-five, Google Analytics 4, Looker Studio |
| Local AI | SenseTime SenseNova / Sensechat, NDN Group |
| Training & Advisory | Pertama Partners, DigiSalad, HKPC Academy |`,
    insights: [
      "ChatGPT dominates at 90% usage among AI-adopting marketers; Adobe Firefly gaining in creative agencies",
      "40%+ of HK organisations now have robust data governance frameworks — up significantly from 2024",
      "SenseTime's Sensechat offers Cantonese-native AI — uniquely relevant for local marketing content",
      "CDPs and RTIM engines form the backbone of sophisticated AI marketing operations in Hong Kong"
    ],
  },
  {
    slug: "regulatory-ethical",
    title: "Regulatory and Ethical Considerations",
    description: "Hong Kong's regulatory landscape and ethical imperatives for AI in marketing",
    displayOrder: 6,
    body: `## The Regulatory Landscape: Principles Over Prescriptions

Hong Kong does not yet have a comprehensive, stand-alone AI law. Instead, the city has adopted a **sector-by-sector, principles-based approach**, with different regulatory bodies overseeing different industries.

The most significant regulatory development to date is the **Hong Kong Generative Artificial Intelligence Technical and Application Guideline**, published on 15 April 2025 by the government's Digital Policy Office (DPO). Crucially, the guidelines are **non-binding** — they establish norms and best practices but do not carry penalties for non-compliance.

The **Personal Data (Privacy) Ordinance (PDPO)** remains the primary legal instrument governing AI use in marketing. Its requirements govern how personal data is collected, used, and retained in AI systems, with particular implications for customer segmentation, targeted advertising, and personalisation engines.

## Deepfakes and AI-Generated Content in Advertising

The risks of AI-generated content have moved from theoretical to front-page in Hong Kong. In 2024, fraudsters used a deepfake video call impersonating a company's CFO to deceive an employee into transferring approximately **HK$200 million**. In 2024 and 2025 combined, police dismantled two criminal syndicates that used deepfakes for fraud totalling nearly **HK$400 million**.

The PCPD has clarified that using personal data to create or disclose deepfake materials — including AI-generated likenesses of people in advertising — may contravene Data Protection Principles 1 and 3 of the PDPO.

## Ethical Imperatives for Marketers

**Transparency in personalisation:** 83% of Hong Kong consumers say they want control over their personalisation settings and the ability to choose how brands communicate with them.

**Algorithmic bias and multilingual equity:** In a market where campaigns must function across Cantonese, English, and Mandarin, AI systems trained predominantly on English-language data risk producing systematically biased outputs.

**Job displacement accountability:** Cathay Pacific's reported restructuring of marketing roles to fund AI investment highlights a tension that will escalate across the industry.`,
    insights: [
      "HK has no standalone AI law — relies on principles-based, non-binding guidelines from the Digital Policy Office",
      "Deepfake fraud totalling HK$400M+ in 2024-2025 has raised urgency for AI content regulation",
      "83% of HK consumers want control over AI personalisation settings — transparency is non-negotiable",
      "Multilingual AI bias is a real risk: campaigns must work across Cantonese, English, and Mandarin"
    ],
  },
  {
    slug: "future-scenarios",
    title: "Future Scenarios and Forecasts",
    description: "Three scenarios for AI in Hong Kong marketing through 2030",
    displayOrder: 7,
    body: `## The Road to 2030: Three Scenarios

The trajectory of AI in Hong Kong's marketing industry over the next three to five years will be shaped by three intersecting forces: the pace of organisational maturity, the evolution of regulatory clarity, and the competitive pressure from GBA-native AI platforms.

### Scenario 1 — Accelerated Convergence (Optimistic)

Building on Q4 2025's advertising recovery and strong government tailwinds — including the **HK$50 million AI education fund** and the "Upskill Hong Kong" retraining initiative — organisations close the AI maturity gap. CDPs, first-party data infrastructure, and RTIM platforms become standard practice among top-50 advertisers. The share of organisations reporting measurable financial impact from AI grows from **23% toward 40% by 2028**.

AI agents — systems capable of executing end-to-end marketing workflows autonomously — begin displacing discrete tool use, consistent with global projections showing agentic AI growing from **USD 7.2 billion in 2025 toward USD 27.7 billion**.

### Scenario 2 — Structural Lag (Realistic)

The majority of organisations remain in the "limited implementation" stage, capturing cost efficiencies from AI in content production and campaign reporting but failing to achieve customer experience transformation. Talent shortages, data fragmentation, and the absence of binding AI governance requirements slow industry-wide progress.

### Scenario 3 — Regulatory Disruption

A significant deepfake advertising incident triggers emergency regulatory action. Hong Kong introduces mandatory AI content labelling for digital advertising. Compliance overhead increases, but trust in AI-produced content is ultimately enhanced.

## Key Metrics to Watch

**Near-term (2026):** Total ad spend recovery with digital-led growth. Internet advertising projected to grow at 7.4% CAGR toward US$2.6B by 2029.

**Medium-term (2027–2029):** Video advertising projected to claim 29.3% of internet advertising. R&D adoption in marketing expected to reach 51%.

**Long-term (2030+):** 75% of C-suite executives expect AI's share of business value to grow by at least 10%. Agentic AI marketing workflows expected to reshape agency staffing models.`,
    insights: [
      "Optimistic scenario: organisations reporting AI financial impact grows from 23% to 40% by 2028",
      "Agentic AI projected to grow from USD 7.2B (2025) to USD 27.7B — transforming marketing workflows",
      "75% of C-suite executives expect AI's business value share to grow by 10%+ in the next 3-5 years",
      "Three scenarios hinge on organisational maturity, regulatory clarity, and GBA platform competition"
    ],
  },
  {
    slug: "data-methodology",
    title: "Data and Methodology",
    description: "Sources, methodology, scope and limitations of this report",
    displayOrder: 8,
    body: `This report is based on a synthesis of primary survey data, industry award records, government policy documentation, corporate announcements, and trade press reporting gathered between Q2 2024 and Q1 2026.

## Industry Surveys

- **HKPC "AI Readiness in Workplace Survey 2025"** (October 2025): ~800 local companies surveyed by HKPC Academy in September 2025.
- **fifty-five Data Governance and AI Adoption Survey 2025:** 350+ professionals at the Google Cloud Summit Hong Kong, published July 2025.
- **Deloitte–HKU AI Adoption Index 2026:** 100+ C-suite leaders across Hong Kong and mainland China, published February 2026.
- **PwC Hong Kong Workforce Hopes and Fears Survey 2025:** Published 2025.
- **Twilio 2025 State of Customer Engagement Report:** 7,640 consumers and 637 business leaders across 18 countries, with Hong Kong-specific data cuts.

## Market Data

- **admanGo HK Ad Spend Report 2025:** Industry-standard tracking of total advertising expenditure by channel.
- **PwC Global Entertainment & Media Outlook 2025–2029** (Hong Kong chapter): Internet advertising forecasts.
- **Statista Generative AI Market Forecast (Hong Kong):** Market sizing and CAGR projections.

## Government and Regulatory Sources

- HKSAR Digital Policy Office: Hong Kong Generative AI Technical and Application Guideline, April 2025.
- Office of the Privacy Commissioner for Personal Data (PCPD): AI Model Personal Data Protection Framework (June 2024) and Guidelines for Use of Generative AI by Employees (March 2025).
- Government Budget Speeches and Policy Address Announcements, 2024–2026.

## Scope and Limitations

This report focuses on Hong Kong's marketing and advertising industry with particular attention to digital, data-driven, and AI-enabled practices. Financial services, aviation, retail, healthcare, and FMCG sectors are covered through documented case studies. SME-level adoption is discussed but data at that segment level is limited. Projections are sourced from third-party research providers and carry inherent uncertainty; they are presented as directional guidance rather than definitive forecasts.

*Report compiled March 2026. Data accurate as of publication date.*`,
    insights: [
      "Based on 5+ major industry surveys covering 1,000+ organisations and 8,000+ respondents",
      "Data sources span Q2 2024 to Q1 2026 — the most current snapshot of HK's AI marketing landscape",
      "Covers financial services, aviation, retail, healthcare, and FMCG with documented case studies",
      "SME-level data is limited; projections are directional guidance from third-party research providers"
    ],
  },
];

async function seed() {
  console.log("Seeding report sections...");

  for (const sectionData of SECTIONS_DATA) {
    const existing = await db
      .select()
      .from(sectionsTable)
      .where(eq(sectionsTable.slug, sectionData.slug))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  Section "${sectionData.slug}" already exists, skipping.`);
      continue;
    }

    const [section] = await db
      .insert(sectionsTable)
      .values({
        slug: sectionData.slug,
        title: sectionData.title,
        description: sectionData.description,
        displayOrder: sectionData.displayOrder,
      })
      .returning();

    const [version] = await db
      .insert(sectionVersionsTable)
      .values({
        sectionId: section.id,
        bodyMarkdown: sectionData.body,
        keyInsights: sectionData.insights,
      })
      .returning();

    await db
      .update(sectionsTable)
      .set({ currentVersionId: version.id })
      .where(eq(sectionsTable.id, section.id));

    console.log(`  Seeded section: ${sectionData.title}`);
  }

  console.log("Seeding complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
