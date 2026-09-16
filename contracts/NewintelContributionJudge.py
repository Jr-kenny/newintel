# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

import json
import typing


class NewintelContributionJudge(gl.Contract):
    """
    Agent-settlement oracle only.

    Scope: which contributing AGENT gets what share of the pool.
    Out of scope: the human/business path. Buyers receive intelligence
    from the orchestrator as usual — this contract never gates, scores,
    refunds, or protects them.

    Lifecycle:
      1. Agent finding → orchestrator + record_finding (store)
      2. Final intel → business (unchanged) + record_final (for matching)
      3. adjudicate → agent weights
      4. Agent USDC payouts only after payout_ready

    Not a need-score. Not a buyer refund. Not human protection.
    """

    # inquiry_id -> json string of AgentSubmissionPackage[]
    findings: TreeMap[str, str]
    # inquiry_id -> json string of final intelligence
    finals: TreeMap[str, str]
    # inquiry_id -> json string of last ContributionWeights
    verdicts: TreeMap[str, str]
    # HTTP endpoint that starts Base USDC payouts (web-oracle inter-comms)
    payout_hook: str
    # Scratch for the in-flight web-oracle POST (strict_eq leader fn)
    _hook_inquiry: str
    _hook_weights: str

    def __init__(self):
        self.findings = TreeMap()
        self.finals = TreeMap()
        self.verdicts = TreeMap()
        self.payout_hook = ""
        self._hook_inquiry = ""
        self._hook_weights = "{}"

    @gl.public.write
    def set_payout_hook(self, url: str) -> bool:
        """Point the judge at the Base payout relayer. Empty string disables."""
        self.payout_hook = str(url)[:300]
        return True

    @gl.public.view
    def get_payout_hook(self) -> str:
        return self.payout_hook

    @gl.public.write
    def request_payout(self, inquiry_id: str) -> typing.Any:
        """
        Inter-comms: after adjudicate, POST the ready verdict to the
        payout relayer under consensus (web oracle). The relayer re-checks
        this contract, then sends USDC on Base. Weights stay on GenLayer
        as the source of truth — the hook only kicks the transfer.
        """
        raw = self.verdicts.get(inquiry_id) or ""
        if not raw:
            return {"ok": False, "note": "no verdict"}
        try:
            verdict = json.loads(raw)
        except Exception:
            return {"ok": False, "note": "bad verdict json"}
        if not verdict.get("ready"):
            return {"ok": False, "note": "payout_ready is false"}
        weights = verdict.get("weights")
        if not isinstance(weights, dict) or len(weights) == 0:
            return {"ok": False, "note": "empty weights"}

        hook = self.payout_hook
        if len(hook) == 0:
            return {"ok": False, "note": "payout hook not set"}

        # Stage payload on self so strict_eq can use a zero-arg leader fn.
        self._hook_inquiry = inquiry_id
        self._hook_weights = json.dumps(weights)
        try:
            delivered = gl.eq_principle.strict_eq(self._post_payout_hook)
        except Exception as e:
            return {"ok": False, "note": "hook error: " + str(e)[:160]}

        return {
            "ok": bool(delivered),
            "inquiry_id": inquiry_id,
            "hook": hook,
            "weights": weights,
            "note": "web-oracle payout trigger" if delivered else "hook not 2xx",
        }

    def _post_payout_hook(self) -> bool:
        """Consensus web-oracle POST. True on 2xx."""
        hook = self.payout_hook
        inquiry_id = str(self._hook_inquiry)
        try:
            weights = json.loads(str(self._hook_weights))
        except Exception:
            weights = {}
        try:
            resp = gl.nondet.web.request(
                hook,
                method="POST",
                body={
                    "inquiry_id": inquiry_id,
                    "weights": weights,
                    "ready": True,
                },
            )
            code = int(resp.status_code)
            return code >= 200 and code < 300
        except Exception:
            return False

    @gl.public.write
    def record_finding(self, inquiry_id: str, agent_id: str, observation_json: typing.Any) -> bool:
        """
        Store one agent observation. Accepts a JSON string OR a parsed
        object (the CLI often delivers dicts — stringify internally).
        """
        if isinstance(observation_json, str):
            try:
                obs = json.loads(observation_json)
            except Exception:
                obs = {"event": str(observation_json)[:300], "sources": []}
        elif isinstance(observation_json, dict):
            obs = observation_json
        else:
            try:
                obs = json.loads(json.dumps(observation_json))
            except Exception:
                obs = {"event": str(observation_json)[:300], "sources": []}

        existing_raw = self.findings.get(inquiry_id) or "[]"
        try:
            packages = json.loads(existing_raw)
        except Exception:
            packages = []
        if not isinstance(packages, list):
            packages = []

        i = 0
        found = False
        while i < len(packages):
            pkg = packages[i]
            if isinstance(pkg, dict) and str(pkg.get("agent_id")) == str(agent_id):
                obs_list = pkg.get("observations") or []
                if not isinstance(obs_list, list):
                    obs_list = []
                obs_list.append(obs)
                pkg["observations"] = obs_list
                found = True
                break
            i += 1
        if not found:
            packages.append({"agent_id": str(agent_id), "observations": [obs]})

        self.findings[inquiry_id] = json.dumps(packages)
        return True

    @gl.public.write
    def record_final(self, inquiry_id: str, payload: typing.Any) -> typing.Any:
        """
        Called after the orchestrator hands the business its intelligence.
        Accepts a JSON string OR an already-parsed object (CLI often delivers
        dicts). Always stores valid JSON text for adjudicate to parse.
        """
        if isinstance(payload, str):
            text = payload
            # If the string is a Python-repr dict, try to normalize.
            if text[:1] == "{":
                try:
                    text = json.dumps(json.loads(text))
                except Exception:
                    pass
        else:
            try:
                text = json.dumps(payload)
            except Exception:
                text = json.dumps({"raw": str(payload)})
        self.finals[inquiry_id] = text
        back = self.finals.get(inquiry_id) or ""
        return {"stored_len": len(back), "has_final": len(back) > 0}

    @gl.public.view
    def get_final(self, inquiry_id: str) -> str:
        return self.finals.get(inquiry_id) or ""

    @gl.public.write
    def adjudicate(self, inquiry_id: str) -> typing.Any:
        """
        Match stored findings against stored final intelligence.
        Returns weights. Settlement MUST NOT pay before this succeeds.
        """
        findings_raw = self.findings.get(inquiry_id) or "[]"
        final_raw = self.finals.get(inquiry_id) or "{}"
        try:
            submissions = json.loads(findings_raw)
        except Exception:
            submissions = []
        if not isinstance(submissions, list) or len(submissions) == 0:
            verdict = {
                "inquiry_id": inquiry_id,
                "ready": False,
                "weights": {},
                "note": "no findings recorded — do not pay",
            }
            self.verdicts[inquiry_id] = json.dumps(verdict)
            return verdict

        # Any non-empty finals[key] counts as recorded (string or JSON).
        if len(final_raw) == 0 or final_raw == "{}":
            verdict = {
                "inquiry_id": inquiry_id,
                "ready": False,
                "weights": {},
                "note": "final intelligence not recorded yet — do not pay",
            }
            self.verdicts[inquiry_id] = json.dumps(verdict)
            return verdict

        try:
            final_intel = json.loads(final_raw)
        except Exception:
            final_intel = {"raw": final_raw}
        if not isinstance(final_intel, dict):
            final_intel = {"raw": str(final_intel)}

        # Deterministic contribution weights — integer milli-shares only
        # (no floats) so GenVM validators agree and never crash.
        try:
            result = self._judge_deterministic(inquiry_id, submissions, final_intel)
            result["ready"] = True
        except Exception as e:
            result = {
                "inquiry_id": inquiry_id,
                "ready": False,
                "weights": {},
                "note": "judge error: " + str(e)[:180],
            }
        self.verdicts[inquiry_id] = json.dumps(result)
        return result

    def _judge_deterministic(
        self,
        inquiry_id: str,
        submissions: list,
        final_intel: typing.Any,
    ) -> typing.Any:
        """Integer milli-weights (sum 1000). Contact/company > location > event."""
        final_blob = str(final_intel).lower()
        try:
            final_blob = json.dumps(final_intel, ensure_ascii=False).lower()
        except Exception:
            pass

        scores: dict = {}
        i = 0
        while i < len(submissions):
            pkg = submissions[i]
            if not isinstance(pkg, dict):
                i = i + 1
                continue
            agent_id = str(pkg.get("agent_id") or "")
            score = 0
            obs_list = pkg.get("observations") or []
            if not isinstance(obs_list, list):
                obs_list = []
            j = 0
            while j < len(obs_list):
                obs = obs_list[j]
                if isinstance(obs, dict):
                    score = score + 10
                    loc = str(obs.get("location") or "")
                    company = str(obs.get("company") or "")
                    contact = str(obs.get("contact") or "")
                    event = str(obs.get("event") or "")
                    if len(loc) > 0:
                        score = score + 10
                    if len(company) > 0:
                        score = score + 20
                        if company.lower() in final_blob:
                            score = score + 20
                    if len(contact) > 0:
                        score = score + 30
                    if len(event) >= 8 and event[:8].lower() in final_blob:
                        score = score + 15
                j = j + 1
            scores[agent_id] = score
            i = i + 1

        total = 0
        sk = list(scores.keys())
        i = 0
        while i < len(sk):
            total = total + int(scores[sk[i]])
            i = i + 1

        weights: dict = {}
        if total > 0:
            i = 0
            acc = 0
            while i < len(sk):
                if i == len(sk) - 1:
                    weights[sk[i]] = 1000 - acc
                else:
                    share = int(int(scores[sk[i]]) * 1000 / total)
                    weights[sk[i]] = share
                    acc = acc + share
                i = i + 1

        return {
            "inquiry_id": inquiry_id,
            "weights": weights,
            "note": "deterministic milli-weights (sum 1000)",
        }

    @gl.public.view
    def get_verdict(self, inquiry_id: str) -> str:
        return self.verdicts.get(inquiry_id) or ""

    @gl.public.view
    def payout_ready(self, inquiry_id: str) -> bool:
        raw = self.verdicts.get(inquiry_id) or ""
        if not raw:
            return False
        try:
            v = json.loads(raw)
        except Exception:
            return False
        return bool(v.get("ready")) and isinstance(v.get("weights"), dict) and len(v.get("weights") or {}) > 0
