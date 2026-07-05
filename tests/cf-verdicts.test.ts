import { describe, expect, it } from "vitest";
import type { CfSubmission } from "@/lib/types";
import { findRaceVerdicts, isFinalVerdict } from "@/lib/cf/verdicts";
import fixture from "./fixtures/user-status.json";

const submissions = fixture.result as CfSubmission[];
const PROBLEM_ID = "1794C";
const SINCE = 1700000000;

describe("isFinalVerdict", () => {
  it("is false for an absent verdict (still testing)", () => {
    expect(isFinalVerdict(undefined)).toBe(false);
  });

  it("is false for in-progress verdicts", () => {
    expect(isFinalVerdict("TESTING")).toBe(false);
    expect(isFinalVerdict("COMPILING")).toBe(false);
  });

  it("is true for final verdicts", () => {
    expect(isFinalVerdict("OK")).toBe(true);
    expect(isFinalVerdict("WRONG_ANSWER")).toBe(true);
    expect(isFinalVerdict("COMPILE_ERROR")).toBe(true);
    expect(isFinalVerdict("TIME_LIMIT_EXCEEDED")).toBe(true);
  });
});

describe("findRaceVerdicts", () => {
  it("picks the earliest OK submission as accepted", () => {
    const { accepted } = findRaceVerdicts(submissions, PROBLEM_ID, SINCE);
    expect(accepted).not.toBeNull();
    expect(accepted?.id).toBe(200000003);
    expect(accepted?.creationTimeSeconds).toBe(1700000100);
  });

  it("collects final non-OK verdicts for the race problem into others", () => {
    const { others } = findRaceVerdicts(submissions, PROBLEM_ID, SINCE);
    const otherIds = others.map((s) => s.id).sort();
    expect(otherIds).toEqual([200000002, 200000004, 200000005]);
    expect(others.map((s) => s.verdict)).toEqual(
      expect.arrayContaining(["WRONG_ANSWER", "COMPILE_ERROR", "TIME_LIMIT_EXCEEDED"]),
    );
  });

  it("does not treat a later OK submission as an 'other' verdict", () => {
    const { others } = findRaceVerdicts(submissions, PROBLEM_ID, SINCE);
    expect(others.some((s) => s.id === 200000006)).toBe(false);
  });

  it("skips submissions still testing (absent verdict)", () => {
    const { others, accepted } = findRaceVerdicts(submissions, PROBLEM_ID, SINCE);
    expect(others.some((s) => s.id === 200000007)).toBe(false);
    expect(accepted?.id).not.toBe(200000007);
  });

  it("ignores submissions to a different problem", () => {
    const { others, accepted } = findRaceVerdicts(submissions, PROBLEM_ID, SINCE);
    expect(others.some((s) => s.id === 200000008)).toBe(false);
    expect(accepted?.id).not.toBe(200000008);
  });

  it("ignores submissions before the cutoff timestamp", () => {
    const { accepted, others } = findRaceVerdicts(submissions, PROBLEM_ID, SINCE);
    expect(accepted?.id).not.toBe(200000001);
    expect(others.some((s) => s.id === 200000001)).toBe(false);
  });

  it("returns accepted: null when there is no OK submission", () => {
    const noAccepted = submissions.filter((s) => s.verdict !== "OK");
    const { accepted } = findRaceVerdicts(noAccepted, PROBLEM_ID, SINCE);
    expect(accepted).toBeNull();
  });

  it("breaks ties between equal-timestamp OK submissions by lowest id", () => {
    const tieA: CfSubmission = {
      id: 5,
      contestId: 1,
      creationTimeSeconds: SINCE + 10,
      problem: { contestId: 1, index: "A", name: "A" },
      author: { members: [{ handle: "x" }] },
      programmingLanguage: "GNU G++17 7.3.0",
      verdict: "OK",
    };
    const tieB: CfSubmission = { ...tieA, id: 3 };
    const { accepted } = findRaceVerdicts([tieA, tieB], "1A", SINCE);
    expect(accepted?.id).toBe(3);
  });
});
