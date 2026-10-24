import { config } from "../config.js";
import { supabase } from "./supabase.js";
import { localStore } from "./localStore.js";

const avg = (xs) => {
  const v = xs.filter((x) => typeof x === "number");
  return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)) : null;
};

async function load(userId) {
  if (config.localMode) {
    return {
      evaluations: localStore.listEvaluations(userId),
      answers: localStore.listChatAll(userId),
      events: localStore.listGuardrailEvents(userId),
      feedback: localStore.listFeedback(userId),
    };
  }
  const db = supabase();
  const [evaluations, answers, events, feedback] = await Promise.all([
    db.from("evaluations").select("briefing_id, faithfulness, completeness, compliance, clarity, overall, checks, grounding, briefings!inner(user_id)").eq("briefings.user_id", userId),
    db.from("chat_messages").select("evaluation").eq("user_id", userId).eq("role", "assistant"),
    db.from("guardrail_events").select("stage, rule, action").eq("user_id", userId),
    db.from("feedback").select("briefing_id, rating").eq("user_id", userId),
  ]);
  for (const r of [evaluations, answers, events, feedback]) if (r.error) throw new Error(r.error.message);
  return { evaluations: evaluations.data, answers: answers.data, events: events.data, feedback: feedback.data };
}

/** Quality dashboard numbers for one advisor: briefing scores, grounding, Q&A scores, guardrails, feedback agreement. */
export async function evalSummary(userId) {
  const { evaluations, answers, events, feedback } = await load(userId);
  const qa = answers.map((a) => a.evaluation).filter(Boolean);

  // Does the judge agree with the advisor? (judge >= 4 should mean thumbs up)
  const byBriefing = new Map(evaluations.map((e) => [e.briefing_id, e.overall]));
  const rated = feedback.filter((f) => byBriefing.has(f.briefing_id));
  const agree = rated.filter((f) => (byBriefing.get(f.briefing_id) >= 4) === (f.rating === 1)).length;

  const countBy = (key) => events.reduce((acc, e) => ({ ...acc, [e[key]]: (acc[e[key]] ?? 0) + 1 }), {});

  return {
    briefings: {
      count: evaluations.length,
      avg_scores: {
        faithfulness: avg(evaluations.map((e) => e.faithfulness)),
        completeness: avg(evaluations.map((e) => e.completeness)),
        compliance: avg(evaluations.map((e) => e.compliance)),
        clarity: avg(evaluations.map((e) => e.clarity)),
        overall: avg(evaluations.map((e) => Number(e.overall))),
      },
      checks_pass_rate: avg(evaluations.map((e) => (e.checks?.total ? e.checks.passed / e.checks.total : null))),
      evidence_match_rate: avg(evaluations.map((e) => e.grounding?.evidence?.rate)),
      numeric_grounding_rate: avg(evaluations.map((e) => e.grounding?.numbers?.rate)),
    },
    questions: {
      count: qa.length,
      avg_scores: {
        faithfulness: avg(qa.map((q) => q.faithfulness)),
        relevance: avg(qa.map((q) => q.relevance)),
        compliance: avg(qa.map((q) => q.compliance)),
        overall: avg(qa.map((q) => q.overall)),
      },
      citation_validity_rate: avg(qa.map((q) => (q.checks ? Number(q.checks.citations_valid) : null))),
    },
    guardrails: { total: events.length, by_rule: countBy("rule"), by_stage: countBy("stage") },
    feedback: { count: feedback.length, judge_agreement_rate: rated.length ? Number((agree / rated.length).toFixed(2)) : null },
  };
}
