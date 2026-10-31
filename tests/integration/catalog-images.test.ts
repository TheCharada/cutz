import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, getPool } from "@/infrastructure/db/client";
import { barbershops, services, staffMembers } from "@/infrastructure/db/schema";
import { LocalStorageProvider } from "@/infrastructure/storage";
import { catalogImageUrl } from "@/modules/catalog/image-url";
import {
  readPublicCatalogImage, removeCatalogImage, uploadCatalogImage,
} from "@/workflows/catalog-images";
import {
  listPublicServicesForBarbershop, listPublicStaffForBarbershop,
} from "@/workflows/public-catalog";

const db = getDb();
const fixtureIds: string[] = [];
const folders: string[] = [];
let fixture: Awaited<ReturnType<typeof setup>>;

async function setup() {
  const key = randomUUID().slice(0, 8);
  const [tenant, other] = await db.insert(barbershops).values([
    { slug: `images-${key}`, name: "Barbearia A", timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30, customerVerificationMode: "NONE", waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 60 },
    { slug: `other-images-${key}`, name: "Barbearia B", timezone: "America/Sao_Paulo",
      bookingIntervalMinutes: 30, customerVerificationMode: "NONE", waitlistOfferTtlMinutes: 10,
      reminderOffsetMinutes: 60 },
  ]).returning();
  fixtureIds.push(tenant.id, other.id);
  const [service] = await db.insert(services).values({
    barbershopId: tenant.id, name: "Corte", durationMinutes: 30, priceCents: 3500,
  }).returning();
  const [staff] = await db.insert(staffMembers).values({
    barbershopId: tenant.id, name: "Ana",
  }).returning();
  const dir = await mkdtemp(join(tmpdir(), "cutz-integration-media-"));
  folders.push(dir);
  return { tenant, other, service, staff, storage: new LocalStorageProvider(dir) };
}

async function png() {
  return sharp({ create: { width: 1800, height: 1000, channels: 3, background: "#995533" } })
    .png().toBuffer();
}

function target(kind: "services" | "staff", id: string, barbershopId = fixture.tenant.id) {
  return { kind, id, barbershopId, slug: fixture.tenant.slug };
}

beforeEach(async () => { fixture = await setup(); });
afterEach(async () => {
  await db.delete(staffMembers).where(eq(staffMembers.id, fixture.staff.id));
  await db.delete(services).where(eq(services.id, fixture.service.id));
  await db.delete(barbershops).where(inArray(barbershops.id, fixtureIds.splice(0)));
  await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
afterAll(async () => { await getPool().end(); });

describe("catalog images", () => {
  it("stores and serves service and staff photos without changing the catalog", async () => {
    const bytes = await png();
    const serviceTarget = target("services", fixture.service.id);
    const staffTarget = target("staff", fixture.staff.id);
    const service = await uploadCatalogImage({ ...serviceTarget, bytes }, { database: db, storage: fixture.storage });
    const staff = await uploadCatalogImage({ ...staffTarget, bytes }, { database: db, storage: fixture.storage });
    expect(service.status).toBe("ok");
    expect(staff.status).toBe("ok");

    const [publicService] = (await listPublicServicesForBarbershop(fixture.tenant.slug, db))!;
    const [publicStaff] = (await listPublicStaffForBarbershop(fixture.tenant.slug, db))!;
    expect(publicService).toMatchObject({ name: "Corte", priceCents: 3500, imageUrl: service.imageUrl });
    expect(publicStaff).toMatchObject({ name: "Ana", imageUrl: staff.imageUrl });

    const read = await readPublicCatalogImage(
      { kind: "services", id: fixture.service.id, slug: fixture.tenant.slug },
      { database: db, storage: fixture.storage },
    );
    expect(read).not.toBeNull();
    expect((await sharp(read!.bytes).metadata()).format).toBe("webp");
    expect(await readPublicCatalogImage(
      { kind: "services", id: fixture.service.id, slug: fixture.other.slug },
      { database: db, storage: fixture.storage },
    )).toBeNull();
  });

  it("replaces and removes images while keeping only the current file", async () => {
    const t = target("services", fixture.service.id);
    const first = await uploadCatalogImage({ ...t, bytes: await png() },
      { database: db, storage: fixture.storage });
    expect(first.status).toBe("ok");
    const old = (await db.select({ imageKey: services.imageKey }).from(services)
      .where(eq(services.id, fixture.service.id)))[0].imageKey!;

    const second = await uploadCatalogImage({ ...t, bytes: await png() },
      { database: db, storage: fixture.storage });
    expect(second.status).toBe("ok");
    expect(second.imageUrl).not.toBe(first.imageUrl);
    expect(await fixture.storage.get(old)).toBeNull();
    const current = (await db.select({ imageKey: services.imageKey }).from(services)
      .where(eq(services.id, fixture.service.id)))[0].imageKey!;
    expect(second.imageUrl).toBe(catalogImageUrl(fixture.tenant.slug, "services", fixture.service.id, current));

    expect((await removeCatalogImage(t, { database: db, storage: fixture.storage })).status).toBe("ok");
    expect((await removeCatalogImage(t, { database: db, storage: fixture.storage })).status).toBe("ok");
    expect(await fixture.storage.get(current)).toBeNull();
    expect((await db.select({ imageKey: services.imageKey }).from(services)
      .where(eq(services.id, fixture.service.id)))[0].imageKey).toBeNull();
  });

  it("does not allow an entity from a different establishment", async () => {
    const bytes = await png();
    expect((await uploadCatalogImage(
      { ...target("services", fixture.service.id, fixture.other.id), bytes },
      { database: db, storage: fixture.storage },
    )).status).toBe("not-found");
    expect((await removeCatalogImage(
      target("staff", fixture.staff.id, fixture.other.id),
      { database: db, storage: fixture.storage },
    )).status).toBe("not-found");
  });

  it("does not replace the current image when processing fails", async () => {
    const t = target("staff", fixture.staff.id);
    const initial = await uploadCatalogImage(
      { ...t, bytes: await png() }, { database: db, storage: fixture.storage },
    );
    expect(initial.status).toBe("ok");
    await expect(uploadCatalogImage(
      { ...t, bytes: Buffer.from("broken image") }, { database: db, storage: fixture.storage },
    )).rejects.toThrow();
    const after = await readPublicCatalogImage(
      { slug: t.slug, kind: t.kind, id: t.id }, { database: db, storage: fixture.storage },
    );
    expect(after).not.toBeNull();
    expect(initial.imageUrl).toContain(after!.imageKey.split("/").at(-1)!.replace(".webp", ""));
  });
});
