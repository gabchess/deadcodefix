import { NextResponse } from "next/server";
import {
  DeveloperSearchRequestSchema,
  runDeveloperIndexSearch,
} from "@/lib/firecrawl-server";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const parsed = DeveloperSearchRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request parameters", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const result = await runDeveloperIndexSearch(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Developer Index lookup failed",
      },
      { status: 502 },
    );
  }
}
