import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import AuctionSession from "@/models/AuctionSession";
import { requireAdmin } from "@/lib/require-admin";
import { MINIMUM_BALANCE_THRESHOLD } from "@/lib/auction-data";

export async function POST(req: Request) {
  const guard = requireAdmin(req);
  if (!guard.ok) return guard.response;

  try {
    await connectDB();
    const { lotId, stageMode, viewerMode, stagePrice } = await req.json();

    const session = await AuctionSession.findOne({ sessionId: "live" });
    if (!session) {
      return NextResponse.json({ success: false, error: "Auction session not found" }, { status: 404 });
    }

    if (viewerMode && ["stage", "ledger", "matrix"].includes(viewerMode)) {
      session.viewerMode = viewerMode;
      if (viewerMode === "ledger") session.stageMode = "board";
      if (viewerMode === "matrix") session.stageMode = "matrix";
      if (viewerMode === "stage") {
        session.stageMode = "spotlight";
      }
    }

    if (lotId !== undefined) {
      session.activeLotId = lotId || null;
      if (lotId) {
        session.viewerMode = "stage";
        session.stageMode = "spotlight";
      } else {
        if (!session.viewerMode || session.viewerMode === "stage") {
          session.viewerMode = "stage";
          session.stageMode = "spotlight";
        }
      }
    }

    if (stageMode && ["auto", "spotlight", "sold", "board", "matrix"].includes(stageMode)) {
      session.stageMode = stageMode;
      if (stageMode === "board") session.viewerMode = "ledger";
      else if (stageMode === "matrix") session.viewerMode = "matrix";
      else if (stageMode === "spotlight" || stageMode === "sold") session.viewerMode = "stage";
    }

    // Live asking price for the projector. A cleared stage has nothing to price.
    if (stagePrice !== undefined) {
      if (!session.activeLotId) {
        session.stagePrice = null;
      } else {
        const teamId = typeof stagePrice === "object" && stagePrice !== null ? stagePrice.teamId : undefined;
        const raw = typeof stagePrice === "object" && stagePrice !== null ? stagePrice.price : stagePrice;
        const n = Number(raw);
        if (raw === null || raw === "" || !Number.isFinite(n) || n < 0) {
          session.stagePrice = null;
        } else {
          // Server-side ceiling so a live number can never advertise a bid its team cannot pay.
          const team = teamId ? session.teams.find((t) => t.teamId === teamId) : null;
          const ceiling = team
            ? Math.max(0, team.currentBalance - MINIMUM_BALANCE_THRESHOLD)
            : Number.MAX_SAFE_INTEGER;
          session.stagePrice = Math.min(Math.round(n), ceiling);
        }
      }
    }

    if (!session.activeLotId) session.stagePrice = null;

    await session.save();

    return NextResponse.json({
      success: true,
      message: lotId ? `Stage set to lot ${lotId}` : `Viewer mode: ${session.viewerMode}`,
      activeLotId: session.activeLotId,
      stageMode: session.stageMode,
      viewerMode: session.viewerMode,
      stagePrice: session.stagePrice,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to update viewer mode / spotlight" },
      { status: 500 }
    );
  }
}
