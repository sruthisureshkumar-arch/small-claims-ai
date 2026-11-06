// Demo disputes for the agent court. Each side's agent only knows its own private brief.
// All names are generic on purpose (no third-party brands).
export type Scenario = {
  id: string;
  label: string;
  title: string;
  description: string;
  price: number;
  buyerName: string;
  sellerName: string;
  sellerEmail: string;
  buyerBrief: string;
  sellerBrief: string;
  fallbackClaim: string;
  fallbackResponse: string;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "camera",
    label: "Used camera, $850",
    title: "Used mirrorless camera",
    description:
      "Mirrorless camera in silver, mint condition, under 3,000 shutter actuations, includes original box, charger and a spare battery. Ships in 2 days.",
    price: 850,
    buyerName: "Ana's agent",
    sellerName: "Raj's agent",
    sellerEmail: "raj-seller@example.com",
    buyerBrief:
      "Your principal Ana received the camera. The front lens has a visible scratch. The menu shows 6,200 shutter actuations, double the listing. The box, charger and spare battery all arrived. Ana wants most of her money back but accepts a fair partial refund.",
    sellerBrief:
      "Your principal Raj packed the camera carefully in bubble wrap and says it was fine when shipped. He never checked the shutter count and only estimated 'under 3,000'. He included all accessories. He believes any scratch happened in transit and wants to be paid.",
    fallbackClaim:
      "The camera arrived with a visible scratch on the front lens, and the shutter count in the menu is 6,200, roughly double the listing's under 3,000. The box, charger and spare battery did arrive. We request a substantial partial refund.",
    fallbackResponse:
      "The camera was in good condition and carefully packed when shipped. The seller did not verify the shutter count and gave an estimate. All listed accessories were included. Any scratch likely occurred in transit, so we ask for payment.",
  },
  {
    id: "logo",
    label: "Logo design, $400",
    title: "Freelance logo design package",
    description:
      "Three distinct logo concepts, two rounds of revisions on the chosen concept, and final files in vector and PNG formats within 7 days.",
    price: 400,
    buyerName: "Maya's agent",
    sellerName: "Dev's agent",
    sellerEmail: "dev-designer@example.com",
    buyerBrief:
      "Your principal Maya received only two concepts, not three. The revision rounds were done and she liked the second concept. Files were delivered in PNG only, with no vector files, which she needs for printing. Delivery was on day 6.",
    sellerBrief:
      "Your principal Dev delivered two strong concepts and says the third was dropped after Maya said she liked the direction of the second. He did both revision rounds. He sent PNG files and offered vector files on request, but Maya never asked.",
    fallbackClaim:
      "We received two logo concepts instead of the three promised, and the final files came only as PNG with no vector format, which is needed for print. Revisions and the deadline were met. We request a partial refund until the missing deliverables arrive.",
    fallbackResponse:
      "Two concepts were delivered and the buyer chose a direction early, so the third was dropped. Both revision rounds were completed on time. Vector files were offered on request and not asked for. We ask for payment.",
  },
  {
    id: "tickets",
    label: "Event tickets, $240",
    title: "Resale of two event tickets",
    description:
      "Two tickets, section 112, row F, adjacent seats, transferred through the official ticketing app before the event.",
    price: 240,
    buyerName: "Sam's agent",
    sellerName: "Lee's agent",
    sellerEmail: "lee-seller@example.com",
    buyerBrief:
      "Your principal Sam received two tickets and entered the event. The tickets were for section 112, row F, but the two seats were not adjacent: they were 6 seats apart. The event itself went ahead as normal.",
    sellerBrief:
      "Your principal Lee transferred two valid tickets for section 112, row F on time through the official app. He says the listing said 'adjacent' because he bought them together but the app assigned the seats. He does not think he is at fault.",
    fallbackClaim:
      "The two tickets were valid and transferred on time, but the listing promised adjacent seats and the seats were six apart. We request a partial refund for that part of the listing.",
    fallbackResponse:
      "Both tickets were valid and transferred on time. The seller bought the pair together and the app assigned the seats, so the separation was not intentional. We ask for payment.",
  },
];

export const getScenario = (id: string) => SCENARIOS.find((s) => s.id === id);
