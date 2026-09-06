import type {
  Belief,
  BeliefKind,
  BeliefScope,
  Cluster,
  Confidence,
  DescartesGraph,
  Reference,
  Relation,
} from "./types";

/**
 * Sample data so the mockup has something to explore. Deliberately mixes
 * levels: axioms, doctrines, derived principles, and concrete practices, at
 * both general and specific scope, with a spread of confidence.
 */

let refSeq = 0;
function ref(citation: string, text?: string, note?: string): Reference {
  refSeq += 1;
  return { id: `seed-ref-${refSeq}`, ref: citation, text, note };
}

function belief(
  id: string,
  kind: BeliefKind,
  scope: BeliefScope,
  confidence: Confidence,
  title: string,
  summary: string,
  opts: Partial<Pick<Belief, "notes" | "references" | "tags">> = {}
): Belief {
  return {
    id,
    kind,
    scope,
    confidence,
    title,
    summary,
    notes: opts.notes ?? "",
    references: opts.references ?? [],
    tags: opts.tags ?? [],
  };
}

const BELIEFS: Belief[] = [
  // ---- Axioms -----------------------------------------------------------
  belief(
    "a_scripture",
    "axiom",
    "general",
    10,
    "Sola Scriptura",
    "Scripture is the final authority for faith and practice.",
    {
      references: [
        ref(
          "2 Timothy 3:16-17",
          "All Scripture is breathed out by God and profitable for teaching..."
        ),
        ref("Isaiah 8:20"),
        ref("Acts 17:11", undefined, "The Bereans test Paul against Scripture."),
      ],
      tags: ["authority", "method"],
    }
  ),
  belief(
    "a_sovereignty",
    "axiom",
    "general",
    9,
    "Sovereignty of God",
    "God ordains and governs all things according to his purpose.",
    {
      references: [
        ref("Ephesians 1:11"),
        ref("Daniel 4:35"),
        ref("Romans 9:15-18"),
        ref("Proverbs 16:9"),
      ],
      tags: ["providence"],
    }
  ),

  // ---- Doctrines --------------------------------------------------------
  belief(
    "d_covenant",
    "doctrine",
    "general",
    8,
    "Covenant theology",
    "God relates to humanity through covenants, and one plan of redemption is administered across history.",
    {
      notes:
        "Framework: covenant of redemption → covenant of works → covenant of grace.\n\nThe main live question is how much continuity to see between Israel and the Church.",
      references: [
        ref(
          "Genesis 17:7",
          "I will establish my covenant between me and you and your offspring after you throughout their generations for an everlasting covenant."
        ),
        ref("Jeremiah 31:31-34"),
        ref("Hebrews 8:6-13"),
        ref("Galatians 3:16-29", undefined, "The promise to Abraham fulfilled in Christ."),
      ],
      tags: ["framework", "redemptive-history"],
    }
  ),
  belief(
    "d_union",
    "doctrine",
    "general",
    9,
    "Union with Christ",
    "Every saving benefit comes to the believer through being joined to Christ.",
    {
      notes:
        "Treat this as the organising centre of soteriology rather than any single benefit.",
      references: [
        ref("Romans 6:3-5"),
        ref("Ephesians 1:3-14", undefined, "'In him' repeated throughout."),
        ref("John 15:4-5"),
        ref("Colossians 3:1-4"),
      ],
      tags: ["soteriology", "centre"],
    }
  ),
  belief(
    "d_imago",
    "doctrine",
    "general",
    10,
    "Imago Dei",
    "Every human bears the image of God.",
    {
      references: [
        ref("Genesis 1:26-27"),
        ref("Genesis 9:6"),
        ref("James 3:9"),
      ],
      tags: ["anthropology"],
    }
  ),
  belief(
    "d_depravity",
    "doctrine",
    "general",
    8,
    "Total depravity",
    "Sin affects every faculty; no one seeks God unaided.",
    {
      references: [
        ref("Romans 3:10-12"),
        ref("Ephesians 2:1-3"),
        ref("Jeremiah 17:9"),
      ],
      tags: ["soteriology", "sin"],
    }
  ),
  belief(
    "d_justification",
    "doctrine",
    "specific",
    10,
    "Justification by faith alone",
    "God declares sinners righteous on the basis of Christ's work, received by faith apart from works.",
    {
      references: [
        ref(
          "Romans 3:28",
          "For we hold that one is justified by faith apart from works of the law."
        ),
        ref("Galatians 2:16"),
        ref("Romans 4:5"),
        ref("Philippians 3:9"),
      ],
      tags: ["soteriology"],
    }
  ),
  belief(
    "d_sanctification",
    "doctrine",
    "specific",
    8,
    "Progressive sanctification",
    "Believers are progressively renewed into Christ's likeness by the Spirit, working out what God works in.",
    {
      references: [
        ref("1 Thessalonians 5:23"),
        ref("Philippians 2:12-13"),
        ref("Romans 8:13"),
      ],
      tags: ["soteriology"],
    }
  ),
  belief(
    "d_perseverance",
    "doctrine",
    "specific",
    7,
    "Perseverance of the saints",
    "Those truly united to Christ will be kept to the end.",
    {
      references: [
        ref("John 10:28-29"),
        ref("Philippians 1:6"),
        ref("Romans 8:38-39"),
      ],
      tags: ["soteriology", "assurance"],
    }
  ),
  belief(
    "d_responsibility",
    "doctrine",
    "general",
    9,
    "Human responsibility",
    "People are genuinely accountable for their choices and are called to repent.",
    {
      references: [
        ref("Deuteronomy 30:19"),
        ref("Acts 17:30"),
        ref("Ezekiel 18:30-32"),
      ],
      tags: ["anthropology"],
    }
  ),
  belief(
    "d_church",
    "doctrine",
    "general",
    7,
    "Church as covenant community",
    "The Church is the visible people of God under the covenant of grace, marked by word and sacrament.",
    {
      references: [
        ref("1 Peter 2:9-10"),
        ref("Acts 2:38-39"),
        ref("Ephesians 2:19-22"),
      ],
      tags: ["ecclesiology"],
    }
  ),
  belief(
    "d_israel",
    "doctrine",
    "specific",
    3,
    "The Church is the continuation of Israel",
    "One people of God across both covenants; the Church is grafted into Israel, not a replacement for it.",
    {
      notes:
        "Options on the table: one people of God (covenantal), distinct programs (dispensational), progressive covenantalism as a middle way. Leaning covenantal but far from settled.",
      references: [
        ref("Romans 11:17-24", undefined, "Olive tree: grafted in, not a new tree."),
        ref("Galatians 6:16"),
        ref("Ephesians 2:11-22"),
      ],
      tags: ["redemptive-history", "ecclesiology"],
    }
  ),
  belief(
    "d_sabbath",
    "doctrine",
    "specific",
    5,
    "Sabbath as creation ordinance",
    "A weekly day of rest is rooted in creation, not only in Mosaic law, and so continues.",
    {
      notes:
        "Need to work through Colossians 2:16-17 and Romans 14:5 before settling this.",
      references: [
        ref("Genesis 2:2-3"),
        ref("Exodus 20:8-11"),
        ref("Mark 2:27"),
        ref("Hebrews 4:9-10"),
      ],
      tags: ["worship", "law"],
    }
  ),

  // ---- Principles -------------------------------------------------------
  belief(
    "p_dignity",
    "principle",
    "general",
    10,
    "Every person has inviolable dignity",
    "Because all bear God's image, no one may be treated as disposable, regardless of usefulness or merit.",
    {
      references: [ref("Genesis 9:6"), ref("Proverbs 14:31"), ref("Matthew 25:40")],
      tags: ["ethics", "anthropology"],
    }
  ),
  belief(
    "p_grace_first",
    "principle",
    "general",
    9,
    "Grace precedes obedience",
    "Obedience is the response to being accepted, never the means of earning it.",
    {
      notes: "The indicative comes before the imperative — Romans 1–11 before Romans 12.",
      references: [
        ref("Romans 12:1", undefined, "'Therefore' — in view of God's mercies."),
        ref("1 Corinthians 4:7"),
        ref("Titus 2:11-12"),
      ],
      tags: ["ethics", "soteriology"],
    }
  ),
  belief(
    "p_rest",
    "principle",
    "general",
    6,
    "Rhythms of rest are part of faithful living",
    "Work and rest are both creational goods; a life without rest denies dependence on God.",
    {
      references: [ref("Psalm 127:2"), ref("Mark 6:31"), ref("Exodus 20:8-11")],
      tags: ["worship"],
    }
  ),

  // ---- Practices --------------------------------------------------------
  belief(
    "t_humble",
    "practice",
    "general",
    9,
    "Be humble",
    "Count others more significant than yourself, after the pattern of Christ.",
    {
      notes:
        "Humility is the posture that follows from justification — if righteousness is received, there is nothing of my own to boast in (1 Cor 4:7).",
      references: [
        ref(
          "Philippians 2:3-8",
          "Do nothing from selfish ambition or conceit, but in humility count others more significant than yourselves."
        ),
        ref("1 Peter 5:5-6"),
        ref("Micah 6:8"),
        ref("James 4:6"),
      ],
      tags: ["character"],
    }
  ),
  belief(
    "t_love",
    "practice",
    "general",
    10,
    "Love your neighbor",
    "Actively seek the good of every person you encounter.",
    {
      references: [
        ref("Leviticus 19:18"),
        ref("Mark 12:31"),
        ref("Romans 13:8-10"),
        ref("1 John 4:20"),
      ],
      tags: ["ethics"],
    }
  ),
  belief(
    "t_forgive",
    "practice",
    "specific",
    9,
    "Forgive as you have been forgiven",
    "Release others from their debts against you because God has released you.",
    {
      references: [
        ref("Ephesians 4:32"),
        ref("Colossians 3:13"),
        ref("Matthew 18:21-35", undefined, "The unforgiving servant."),
        ref("Matthew 6:12"),
      ],
      tags: ["ethics", "relationships"],
    }
  ),
  belief(
    "t_poor",
    "practice",
    "specific",
    9,
    "Care for the poor",
    "Open your hand to the needy as a matter of obedience, not optional charity.",
    {
      references: [
        ref("Deuteronomy 15:7-11"),
        ref("Proverbs 19:17"),
        ref("James 2:14-17"),
        ref("Matthew 25:35-40"),
      ],
      tags: ["ethics", "justice"],
    }
  ),
  belief(
    "t_pray",
    "practice",
    "general",
    8,
    "Pray without ceasing",
    "Maintain continual dependence on God in prayer.",
    {
      references: [
        ref("1 Thessalonians 5:17"),
        ref("Luke 18:1"),
        ref("Philippians 4:6-7"),
      ],
      tags: ["devotion"],
    }
  ),
  belief(
    "t_rest",
    "practice",
    "specific",
    5,
    "Keep a weekly day of rest and worship",
    "Set aside one day in seven for rest and gathered worship.",
    {
      references: [
        ref("Exodus 20:8-11"),
        ref("Isaiah 58:13-14"),
        ref("Hebrews 10:25"),
      ],
      tags: ["worship"],
    }
  ),
  belief(
    "t_baptize",
    "practice",
    "specific",
    4,
    "Baptize the children of believers",
    "Children of believers are included in the covenant community and receive its sign.",
    {
      notes:
        "Follows if the covenant sign works the same way it did for Abraham's household. Stands or falls with the Israel/Church continuity question.",
      references: [
        ref("Genesis 17:7-12"),
        ref("Acts 2:38-39", "For the promise is for you and for your children..."),
        ref("Acts 16:31-33"),
        ref("Colossians 2:11-12"),
      ],
      tags: ["sacraments", "ecclesiology"],
    }
  ),
];

let relSeq = 0;
function rel(
  source: string,
  target: string,
  kind: Relation["kind"],
  note?: string
): Relation {
  relSeq += 1;
  return { id: `seed-rel-${relSeq}`, source, target, kind, note };
}

const RELATIONS: Relation[] = [
  // Axioms ground the framework doctrines.
  rel("a_scripture", "d_covenant", "grounds"),
  rel("a_sovereignty", "d_perseverance", "grounds"),
  rel("a_sovereignty", "d_responsibility", "tension", "Compatibilism holds these together, but the tension is felt."),

  // Doctrine to doctrine.
  rel("d_covenant", "d_church", "grounds"),
  rel("d_covenant", "d_sabbath", "grounds"),
  rel("d_covenant", "d_justification", "grounds", "Covenant of grace."),
  rel("d_covenant", "d_israel", "implies"),
  rel("d_union", "d_justification", "grounds"),
  rel("d_union", "d_sanctification", "grounds"),
  rel("d_union", "d_perseverance", "grounds"),
  rel("d_depravity", "d_justification", "implies", "If wholly dead, righteousness must be received, not achieved."),
  rel("d_responsibility", "d_perseverance", "qualifies", "The warning passages are real warnings."),
  rel("d_israel", "d_church", "qualifies"),

  // Doctrine to principle.
  rel("d_imago", "p_dignity", "grounds"),
  rel("d_justification", "p_grace_first", "grounds"),
  rel("d_sabbath", "p_rest", "grounds"),

  // Principle / doctrine to practice.
  rel("p_dignity", "t_love", "applies"),
  rel("p_dignity", "t_poor", "applies"),
  rel("p_grace_first", "t_humble", "applies", "Nothing to boast in."),
  rel("p_grace_first", "t_forgive", "applies"),
  rel("p_rest", "t_rest", "applies"),
  rel("d_sanctification", "t_pray", "applies"),
  rel("d_church", "t_baptize", "applies"),
  rel("d_israel", "t_baptize", "qualifies"),

  // Practice to practice.
  rel("t_love", "t_poor", "implies"),
  rel("t_love", "t_forgive", "implies"),
];

const CLUSTERS: Cluster[] = [
  {
    id: "seed-cluster-soteriology",
    label: "Soteriology",
    description: "How salvation is accomplished and applied.",
    color: "#1E88E5",
    memberIds: [
      "d_union",
      "d_depravity",
      "d_justification",
      "d_sanctification",
      "d_perseverance",
    ],
  },
  {
    id: "seed-cluster-living",
    label: "Christian living",
    description: "Concrete shape of a life formed by the gospel.",
    color: "#43A047",
    memberIds: ["p_grace_first", "p_dignity", "t_humble", "t_love", "t_forgive", "t_poor", "t_pray"],
  },
  {
    id: "seed-cluster-ecclesiology",
    label: "Ecclesiology & sacraments",
    color: "#F4511E",
    memberIds: ["d_church", "t_baptize", "d_israel"],
  },
  {
    id: "seed-cluster-sabbath",
    label: "Sabbath",
    color: "#8E24AA",
    memberIds: ["d_sabbath", "p_rest", "t_rest"],
  },
];

/** Fresh copy of the sample graph, without positions (caller lays it out). */
export function seedGraph(): DescartesGraph {
  return {
    beliefs: Object.fromEntries(BELIEFS.map((b) => [b.id, { ...b }])),
    relations: RELATIONS.map((r) => ({ ...r })),
    clusters: CLUSTERS.map((c) => ({ ...c, memberIds: [...c.memberIds] })),
    positions: {},
  };
}
