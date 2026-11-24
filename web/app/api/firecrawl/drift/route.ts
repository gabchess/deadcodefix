import { NextResponse } from "next/server";
import {
  DriftScanRequestSchema,
  runLiveChangeTrackingScan,
} from "@/lib/firecrawl-server";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const parsed = DriftScanRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid drift scan URL or tag", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const result = await runLiveChangeTrackingScan(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Firecrawl drift scan failed";
    const status = message.includes("requires FIRECRAWL_API_KEY") ? 403 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
