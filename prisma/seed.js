import { createHash } from "node:crypto";
import prisma from "../src/config/prismaClient.js";

const USER_ID = "36fcbdfa-1636-40cc-a39a-5bc21d30fa9e";
const SEED_NAMESPACE = `propertydek-test-fixtures:${USER_ID}`;
const SEEDED_AT = new Date("2026-10-15T12:00:00.000Z");

function fixtureId(name) {
  const bytes = createHash("sha256")
    .update(`${SEED_NAMESPACE}:${name}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fixture(model, name, data) {
  return { id: fixtureId(`${model}:${name}`), ...data };
}

async function upsertFixtures(transaction, model, records) {
  for (const record of records) {
    await transaction[model].upsert({
      where: { id: record.id },
      create: record,
      update: record,
    });
  }
}

const properties = [
  {
    key: "willow-creek",
    name: "Willow Creek Apartments",
    type: "APARTMENT",
    addressLine1: "100 Willow Creek Road",
    city: "Portland",
    region: "OR",
    postalCode: "97205",
    description: "Mid-rise apartment community near downtown.",
    units: [
      ["101", 1, 1, 780, 1650, "OCCUPIED"],
      ["102", 2, 1, 920, 1850, "OCCUPIED"],
      ["201", 2, 2, 1120, 2200, "OCCUPIED"],
      ["202", 1, 1, 800, 1725, "AVAILABLE"],
    ],
  },
  {
    key: "maple-court",
    name: "Maple Court Homes",
    type: "HOUSE",
    addressLine1: "2400 Maple Court",
    city: "Beaverton",
    region: "OR",
    postalCode: "97005",
    description: "Townhome-style homes with private garages.",
    units: [
      ["A", 2, 1.5, 1180, 2100, "OCCUPIED"],
      ["B", 3, 2, 1460, 2450, "OCCUPIED"],
      ["C", 2, 2, 1240, 2250, "RESERVED"],
      ["D", 3, 2.5, 1580, 2650, "AVAILABLE"],
    ],
  },
  {
    key: "harbor-square",
    name: "Harbor Square Lofts",
    type: "CONDO",
    addressLine1: "18 Harbor Square",
    city: "Vancouver",
    region: "WA",
    postalCode: "98660",
    description: "Urban loft residences with shared amenities.",
    units: [
      ["3A", 1, 1, 710, 1780, "OCCUPIED"],
      ["3B", 2, 2, 1050, 2325, "OCCUPIED"],
      ["4A", 2, 2, 1090, 2390, "MAINTENANCE"],
      ["4B", 1, 1, 740, 1840, "AVAILABLE"],
    ],
  },
];

const tenants = [
  ["avery-johnson", "Avery Johnson", "avery.johnson@example.test", "503-555-0101"],
  ["riley-chen", "Riley Chen", "riley.chen@example.test", "503-555-0102"],
  ["jordan-patel", "Jordan Patel", "jordan.patel@example.test", "503-555-0103"],
  ["morgan-davis", "Morgan Davis", "morgan.davis@example.test", "503-555-0104"],
  ["casey-martin", "Casey Martin", "casey.martin@example.test", "503-555-0105"],
  ["taylor-brooks", "Taylor Brooks", "taylor.brooks@example.test", "503-555-0106"],
  ["sam-rivera", "Sam Rivera", "sam.rivera@example.test", "503-555-0107"],
  ["jamie-wilson", "Jamie Wilson", "jamie.wilson@example.test", "503-555-0108"],
].map(([key, fullName, email, phone], index) =>
  fixture("tenant", key, {
    organizationId: fixtureId("organization"),
    fullName,
    email,
    phone,
    emergencyContact: `Emergency Contact ${index + 1}`,
    emergencyPhone: `503-555-02${String(index + 1).padStart(2, "0")}`,
    notes: index % 2 === 0 ? "Test fixture tenant record." : null,
    createdAt: SEEDED_AT,
  }),
);

function unitId(propertyKey, unitNumber) {
  return fixtureId(`unit:${propertyKey}:${unitNumber}`);
}

const propertyRecords = properties.map((property) =>
  fixture("property", property.key, {
    name: property.name,
    type: property.type,
    addressLine1: property.addressLine1,
    city: property.city,
    region: property.region,
    postalCode: property.postalCode,
    description: property.description,
    organizationId: fixtureId("organization"),
    countryCode: "US",
    timezone: "America/Los_Angeles",
    createdAt: SEEDED_AT,
  }),
);

const unitRecords = properties.flatMap((property) =>
  property.units.map(([unitNumber, bedrooms, bathrooms, squareFeet, monthlyRent, status], index) =>
    fixture("unit", `${property.key}:${unitNumber}`, {
      propertyId: fixtureId(`property:${property.key}`),
      unitNumber,
      floor: property.key === "willow-creek" ? (index < 2 ? 1 : 2) : null,
      bedrooms,
      bathrooms,
      squareFeet,
      monthlyRent,
      status,
      description: `${bedrooms}-bedroom test unit.`,
      createdAt: SEEDED_AT,
    }),
  ),
);

const leaseSpecs = [
  { tenant: 0, property: 0, unit: "101", status: "ACTIVE", start: "2026-01-01", end: "2026-12-31", rent: 1650 },
  { tenant: 1, property: 0, unit: "102", status: "ACTIVE", start: "2026-03-01", end: "2027-02-28", rent: 1850 },
  { tenant: 2, property: 0, unit: "201", status: "ACTIVE", start: "2026-02-01", end: "2027-01-31", rent: 2200 },
  { tenant: 3, property: 1, unit: "A", status: "ACTIVE", start: "2026-04-01", end: "2027-03-31", rent: 2100 },
  { tenant: 4, property: 1, unit: "B", status: "ACTIVE", start: "2026-06-01", end: "2027-05-31", rent: 2450 },
  { tenant: 5, property: 2, unit: "3A", status: "ACTIVE", start: "2026-01-15", end: "2027-01-14", rent: 1780 },
  { tenant: 6, property: 2, unit: "3B", status: "ENDED", start: "2025-01-01", end: "2025-12-31", rent: 2325 },
  { tenant: 7, property: 1, unit: "C", status: "DRAFT", start: "2026-12-01", end: "2027-11-30", rent: 2250 },
];

const leaseRecords = leaseSpecs.map((lease, index) =>
  fixture("lease", `lease-${index + 1}`, {
    organizationId: fixtureId("organization"),
    unitId: unitId(properties[lease.property].key, lease.unit),
    tenantId: tenants[lease.tenant].id,
    status: lease.status,
    startDate: new Date(`${lease.start}T00:00:00.000Z`),
    endDate: new Date(`${lease.end}T00:00:00.000Z`),
    monthlyRent: lease.rent,
    securityDeposit: lease.rent,
    rentDueDay: 1,
    lateFee: 75,
    signedAt: lease.status === "ACTIVE" ? new Date(`${lease.start}T12:00:00.000Z`) : null,
    terms: "Seeded test lease; no real-world tenancy is represented.",
    createdAt: SEEDED_AT,
  }),
);

const invoiceStatuses = ["PAID", "PAID", "PAID", "PAID", "PARTIALLY_PAID", "OPEN", "OVERDUE", "DRAFT"];
const invoiceRecords = leaseRecords.map((lease, index) =>
  fixture("invoice", `invoice-${index + 1}`, {
    organizationId: fixtureId("organization"),
    leaseId: lease.id,
    invoiceNumber: `TEST-2026-${String(index + 1).padStart(4, "0")}`,
    description: `Test rent invoice ${index + 1}`,
    periodStart: new Date("2026-10-01T00:00:00.000Z"),
    periodEnd: new Date("2026-10-31T00:00:00.000Z"),
    issuedAt: new Date("2026-10-01T12:00:00.000Z"),
    dueAt: new Date(index === 6 ? "2026-10-05T12:00:00.000Z" : "2026-11-05T12:00:00.000Z"),
    subtotal: leaseSpecs[index].rent,
    tax: 0,
    total: leaseSpecs[index].rent,
    currency: "USD",
    status: invoiceStatuses[index],
    paidAt: invoiceStatuses[index] === "PAID" ? new Date("2026-10-03T12:00:00.000Z") : null,
    createdAt: SEEDED_AT,
  }),
);

const paymentRecords = invoiceRecords.slice(0, 7).map((invoice, index) => {
  const status = index < 4 ? "SUCCEEDED" : index === 4 ? "SUCCEEDED" : index === 5 ? "PENDING" : "FAILED";
  return fixture("payment", `payment-${index + 1}`, {
    organizationId: fixtureId("organization"),
    leaseId: leaseRecords[index].id,
    invoiceId: invoice.id,
    amount: status === "SUCCEEDED" && index === 4 ? leaseSpecs[index].rent / 2 : leaseSpecs[index].rent,
    currency: "USD",
    method: ["BANK_TRANSFER", "CARD", "CHECK", "CASH", "BANK_TRANSFER", "OTHER", "CARD"][index],
    status,
    paidAt: status === "SUCCEEDED" ? new Date("2026-10-03T12:00:00.000Z") : null,
    notes: "Seeded test payment.",
    createdAt: SEEDED_AT,
  });
});

const maintenanceSpecs = [
  { title: "Kitchen faucet is dripping", property: 0, unit: "101", tenant: 0, priority: "LOW", status: "COMPLETED", category: "Plumbing" },
  { title: "Heating system inspection", property: 0, unit: "102", tenant: 1, priority: "MEDIUM", status: "IN_PROGRESS", category: "HVAC" },
  { title: "Replace hallway light fixture", property: 0, unit: "201", tenant: 2, priority: "LOW", status: "OPEN", category: "Electrical" },
  { title: "Garage door will not close", property: 1, unit: "A", tenant: 3, priority: "HIGH", status: "OPEN", category: "Appliance" },
  { title: "Water pressure is low", property: 1, unit: "B", tenant: 4, priority: "MEDIUM", status: "ON_HOLD", category: "Plumbing" },
  { title: "Check bathroom exhaust fan", property: 2, unit: "3A", tenant: 5, priority: "URGENT", status: "OPEN", category: "Electrical" },
];
const maintenanceRecords = maintenanceSpecs.map((request, index) =>
  fixture("maintenance", `request-${index + 1}`, {
    organizationId: fixtureId("organization"),
    propertyId: fixtureId(`property:${properties[request.property].key}`),
    unitId: unitId(properties[request.property].key, request.unit),
    tenantId: tenants[request.tenant].id,
    title: request.title,
    description: `${request.title}. Created as a test fixture for maintenance workflows.`,
    category: request.category,
    priority: request.priority,
    status: request.status,
    requestedAt: new Date(`2026-10-${String(8 + index).padStart(2, "0")}T12:00:00.000Z`),
    scheduledAt: request.status === "IN_PROGRESS" ? new Date("2026-10-21T15:00:00.000Z") : null,
    completedAt: request.status === "COMPLETED" ? new Date("2026-10-20T15:00:00.000Z") : null,
    createdAt: SEEDED_AT,
  }),
);

const technicians = [
  ["elena-garcia", "Elena Garcia", "elena.garcia@example.test", ["Plumbing", "General repairs"]],
  ["noah-thompson", "Noah Thompson", "noah.thompson@example.test", ["HVAC", "Electrical"]],
  ["mia-walker", "Mia Walker", "mia.walker@example.test", ["Appliances", "Electrical"]],
].map(([key, fullName, email, specialties]) =>
  fixture("technician", key, {
    organizationId: fixtureId("organization"),
    fullName,
    email,
    phone: "503-555-0300",
    specialties,
    isActive: true,
    createdAt: SEEDED_AT,
  }),
);

const assignments = [
  [0, 0, "COMPLETED"],
  [1, 1, "IN_PROGRESS"],
  [3, 2, "ACCEPTED"],
  [5, 1, "ASSIGNED"],
].map(([requestIndex, technicianIndex, status], index) =>
  fixture("assignment", `assignment-${index + 1}`, {
    maintenanceRequestId: maintenanceRecords[requestIndex].id,
    technicianId: technicians[technicianIndex].id,
    status,
    assignedAt: new Date("2026-10-16T12:00:00.000Z"),
    completedAt: status === "COMPLETED" ? new Date("2026-10-20T15:00:00.000Z") : null,
    notes: "Seeded test assignment.",
  }),
);

const comments = maintenanceRecords.slice(0, 4).map((request, index) =>
  fixture("maintenance-comment", `comment-${index + 1}`, {
    maintenanceRequestId: request.id,
    authorUserId: USER_ID,
    body: [
      "Thanks for reporting this. We have completed the repair.",
      "A technician is scheduled to inspect this issue.",
      "We are reviewing the request and will follow up soon.",
      "The assigned technician has accepted this request.",
    ][index],
    isInternal: index === 1,
    createdAt: new Date(`2026-10-${String(20 + index).padStart(2, "0")}T12:00:00.000Z`),
  }),
);

const notifications = [
  ["maintenance-update", "MAINTENANCE", "Maintenance request updated", "A technician accepted the garage door repair request.", false],
  ["payment-received", "PAYMENT", "Rent payment recorded", "A test payment was recorded for invoice TEST-2026-0001.", true],
  ["lease-reminder", "LEASE", "Lease ending soon", "A sample lease is approaching its end date.", false],
  ["system-welcome", "SYSTEM", "Test portfolio is ready", "This workspace contains seeded test fixtures.", false],
].map(([key, type, title, body, read]) =>
  fixture("notification", key, {
    organizationId: fixtureId("organization"),
    userId: USER_ID,
    type,
    title,
    body,
    data: { seeded: true },
    readAt: read ? new Date("2026-10-18T12:00:00.000Z") : null,
    createdAt: SEEDED_AT,
  }),
);

const agent = fixture("ai-agent", "portfolio-assistant", {
  organizationId: fixtureId("organization"),
  name: "Portfolio Assistant (Test)",
  slug: "portfolio-assistant-test",
  description: "Seeded assistant record for testing AI conversations.",
  systemPrompt: "You are a demo property management assistant.",
  model: "test-model",
  configuration: { seeded: true },
  isActive: true,
  createdAt: SEEDED_AT,
});
const conversation = fixture("conversation", "portfolio-summary", {
  organizationId: fixtureId("organization"),
  userId: USER_ID,
  title: "Test portfolio summary",
  status: "ACTIVE",
  createdAt: SEEDED_AT,
});
const messages = [
  fixture("message", "user-question", {
    conversationId: conversation.id,
    userId: USER_ID,
    role: "USER",
    content: "Summarize the sample portfolio.",
    metadata: { seeded: true },
    createdAt: new Date("2026-10-20T12:00:00.000Z"),
  }),
  fixture("message", "assistant-response", {
    conversationId: conversation.id,
    role: "ASSISTANT",
    content: "The sample portfolio contains three properties with twelve units.",
    metadata: { seeded: true },
    createdAt: new Date("2026-10-20T12:01:00.000Z"),
  }),
];
const toolExecution = fixture("ai-tool-execution", "portfolio-summary", {
  agentId: agent.id,
  conversationId: conversation.id,
  messageId: messages[1].id,
  toolName: "get_portfolio_summary",
  input: { organizationId: fixtureId("organization") },
  output: { propertyCount: 3, unitCount: 12, tenantCount: 8 },
  status: "SUCCEEDED",
  startedAt: new Date("2026-10-20T12:00:30.000Z"),
  finishedAt: new Date("2026-10-20T12:00:31.000Z"),
});
const importJob = fixture("import-job", "tenants-csv", {
  organizationId: fixtureId("organization"),
  createdByUserId: USER_ID,
  fileName: "sample-tenants.csv",
  status: "AWAITING_FILE",
  result: { seeded: true, note: "No file is attached to this test import." },
  createdAt: SEEDED_AT,
});
const auditLogs = [
  ["organization-created", "CREATE", "organization", fixtureId("organization")],
  ["properties-seeded", "SEED", "property", fixtureId("property:willow-creek")],
  ["leases-seeded", "SEED", "lease", leaseRecords[0].id],
].map(([key, action, entityType, entityId]) =>
  fixture("audit-log", key, {
    organizationId: fixtureId("organization"),
    actorUserId: USER_ID,
    action,
    entityType,
    entityId,
    details: { seeded: true },
    createdAt: SEEDED_AT,
  }),
);

async function main() {
  const user = await prisma.user.findUnique({
    where: { id: USER_ID },
    select: { id: true, email: true },
  });
  if (!user) {
    throw new Error(`Cannot seed fixtures: user ${USER_ID} does not exist.`);
  }

  const organizationId = fixtureId("organization");
  const organization = fixture("organization", "portfolio", {
    id: organizationId,
    name: "PropertyDek Test Portfolio",
    slug: `propertydek-test-${USER_ID.slice(0, 8)}`,
    countryCode: "US",
    timezone: "America/Los_Angeles",
    setupMethod: "DEMO",
    onboardingCompleted: true,
    teamStepCompletedAt: SEEDED_AT,
    teamStepSkipped: true,
    demoDataCreatedAt: SEEDED_AT,
    billingEmail: user.email,
  });

  const counts = await prisma.$transaction(async (transaction) => {
    const invoiceCurrencyColumn = await transaction.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'invoices'
        AND column_name = 'currency'
      LIMIT 1
    `;
    const supportsInvoiceFixtures = invoiceCurrencyColumn.length > 0;

    await transaction.organization.upsert({
      where: { id: organization.id },
      create: organization,
      update: organization,
    });
    await transaction.membership.upsert({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: USER_ID,
        },
      },
      create: {
        id: fixtureId("membership:owner"),
        organizationId: organization.id,
        userId: USER_ID,
        role: "OWNER",
        status: "ACTIVE",
        joinedAt: SEEDED_AT,
      },
      update: { role: "OWNER", status: "ACTIVE", joinedAt: SEEDED_AT },
    });

    await upsertFixtures(transaction, "property", propertyRecords);
    await upsertFixtures(transaction, "unit", unitRecords);
    await upsertFixtures(transaction, "tenant", tenants);
    await upsertFixtures(transaction, "lease", leaseRecords);
    if (supportsInvoiceFixtures) {
      await upsertFixtures(transaction, "invoice", invoiceRecords);
      await upsertFixtures(transaction, "payment", paymentRecords);
    }
    await upsertFixtures(transaction, "maintenanceRequest", maintenanceRecords);
    await upsertFixtures(transaction, "technician", technicians);
    await upsertFixtures(transaction, "maintenanceAssignment", assignments);
    await upsertFixtures(transaction, "maintenanceComment", comments);
    await upsertFixtures(transaction, "aiAgent", [agent]);
    await upsertFixtures(transaction, "conversation", [conversation]);
    await upsertFixtures(transaction, "message", messages);
    await upsertFixtures(transaction, "aiToolExecution", [toolExecution]);
    await upsertFixtures(transaction, "notification", notifications);
    await upsertFixtures(transaction, "importJob", [importJob]);
    await upsertFixtures(transaction, "auditLog", auditLogs);

    return {
      organizations: 1,
      properties: propertyRecords.length,
      units: unitRecords.length,
      tenants: tenants.length,
      leases: leaseRecords.length,
      invoices: supportsInvoiceFixtures ? invoiceRecords.length : 0,
      payments: supportsInvoiceFixtures ? paymentRecords.length : 0,
      maintenanceRequests: maintenanceRecords.length,
      technicians: technicians.length,
      maintenanceAssignments: assignments.length,
      maintenanceComments: comments.length,
      notifications: notifications.length,
      conversations: 1,
      messages: messages.length,
      imports: 1,
      auditLogs: auditLogs.length,
      skippedModels: supportsInvoiceFixtures
        ? []
        : ["invoices and payments (database is missing invoices.currency)"],
    };
  }, { maxWait: 10000, timeout: 90000 });

  console.log(`Seeded test fixtures for user ${USER_ID}:`);
  console.log(JSON.stringify(counts, null, 2));
  if (counts.skippedModels.length > 0) {
    console.warn("Some fixture models were skipped because the database schema is behind.");
  }
}

main()
  .catch((error) => {
    console.error("Test fixture seeding failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
