import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getCurrentUserOrNull } from "@/lib/auth";
import { SYSTEM, MODELO, TOOL_SCHEMAS, TOOLS } from "@/lib/asistente";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Copiloto: recibe la conversación, deja que Claude use las herramientas que
 *  leen Neon (loop de tool-use) y devuelve la respuesta final. Solo lectura. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUserOrNull();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Falta ANTHROPIC_API_KEY en el servidor (pégala en Vercel)." }, { status: 503 });
  }

  let messages: { role: "user" | "assistant"; content: string }[];
  try {
    ({ messages } = await req.json());
    if (!Array.isArray(messages) || !messages.length) throw new Error();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
  }

  const anthropic = new Anthropic();
  const convo: Anthropic.MessageParam[] = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 8000) }));

  const usados: string[] = [];
  try {
    for (let paso = 0; paso < 6; paso++) {
      const resp = await anthropic.messages.create({
        model: MODELO, max_tokens: 1200, system: SYSTEM,
        tools: TOOL_SCHEMAS as Anthropic.Tool[], messages: convo,
      });
      const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!toolUses.length) {
        const texto = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");
        return NextResponse.json({ respuesta: texto, herramientas: usados });
      }
      convo.push({ role: "assistant", content: resp.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        usados.push(tu.name);
        let out: unknown;
        try {
          out = TOOLS[tu.name] ? await TOOLS[tu.name].run(tu.input as Record<string, unknown>) : { error: "herramienta desconocida" };
        } catch (e) {
          out = { error: String((e as Error).message) };
        }
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
      }
      convo.push({ role: "user", content: results });
    }
    return NextResponse.json({ respuesta: "La consulta necesitó demasiados pasos; reformúlala más específica.", herramientas: usados });
  } catch (e) {
    return NextResponse.json({ error: "Error del asistente: " + (e as Error).message }, { status: 500 });
  }
}
