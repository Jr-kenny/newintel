# Newintel contribution judge — Studio Next (chain 61997) build.
# ASCII-only source. No pinned Depends hash so GenVM can resolve py-genlayer.
from genlayer import *

import json
import typing


class NewintelContributionJudge(gl.Contract):
    """Agent-settlement oracle. Splits the run pool among contributing agents."""

    findings: TreeMap[str, str]
    finals: TreeMap[str, str]
    verdicts: TreeMap[str, str]
    payout_hook: str

    def __init__(self):
        self.findings = TreeMap()
        self.finals = TreeMap()
        self.verdicts = TreeMap()
        self.payout_hook = ""

    @gl.public.write
    def set_payout_hook(self, url: str) -> bool:
        self.payout_hook = str(url)[:300]
        return True

    @gl.public.view
    def get_payout_hook(self) -> str:
        return self.payout_hook

    @gl.public.write
    def record_finding(self, inquiry_id: str, agent_id: str, observation_json: typing.Any) -> bool:
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

        found = False
        i = 0
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
            i = i + 1
        if not found:
            packages.append({"agent_id": str(agent_id), "observations": [obs]})

        self.findings[inquiry_id] = json.dumps(packages)
        return True

    @gl.public.write
    def record_final(self, inquiry_id: str, payload: typing.Any) -> typing.Any:
        if isinstance(payload, str):
            text = payload
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
                "note": "no findings recorded - do not pay",
            }
            self.verdicts[inquiry_id] = json.dumps(verdict)
            return verdict

        if len(final_raw) == 0 or final_raw == "{}":
            verdict = {
                "inquiry_id": inquiry_id,
                "ready": False,
                "weights": {},
                "note": "final intelligence not recorded yet - do not pay",
            }
            self.verdicts[inquiry_id] = json.dumps(verdict)
            return verdict

        try:
            final_intel = json.loads(final_raw)
        except Exception:
            final_intel = {"raw": final_raw}
        if not isinstance(final_intel, dict):
            final_intel = {"raw": str(final_intel)}

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

    @gl.public.view
    def payout_ready(self, inquiry_id: str) -> bool:
        raw = self.verdicts.get(inquiry_id) or ""
        if not raw:
            return False
        try:
            verdict = json.loads(raw)
            return bool(verdict.get("ready"))
        except Exception:
            return False

    @gl.public.view
    def get_verdict(self, inquiry_id: str) -> str:
        return self.verdicts.get(inquiry_id) or ""

    def _judge_deterministic(self, inquiry_id, submissions, final_intel) -> typing.Any:
        try:
            final_blob = json.dumps(final_intel, ensure_ascii=False).lower()
        except Exception:
            final_blob = str(final_intel).lower()

        scores = {}
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
                    company = str(obs.get("company") or "").lower()
                    event = str(obs.get("event") or "").lower()
                    contact = str(obs.get("contact") or "").lower()
                    location = str(obs.get("location") or "").lower()
                    sources = obs.get("sources") or []
                    recalls = int(obs.get("verified_recalls") or 0)
                    if company and company in final_blob:
                        score = score + 40
                    if contact and len(contact) > 3:
                        score = score + 30
                    if location and location in final_blob:
                        score = score + 15
                    if event and len(event) > 10:
                        score = score + 10
                    if isinstance(sources, list) and len(sources) > 0:
                        score = score + 5 * min(len(sources), 3)
                    if recalls > 0:
                        score = score + 20 * min(recalls, 3)
                j = j + 1
            scores[agent_id] = score
            i = i + 1

        total = 0
        for v in scores.values():
            total = total + int(v)
        weights = {}
        if total <= 0:
            # equal split when nothing scored - still integer milli-shares
            n = len(scores) if len(scores) > 0 else 1
            each = 1000 // n
            rem = 1000 - each * n
            first = True
            for k in scores.keys():
                weights[k] = each + (rem if first else 0)
                first = False
        else:
            acc = 0
            keys = list(scores.keys())
            t = 0
            while t < len(keys):
                k = keys[t]
                if t == len(keys) - 1:
                    weights[k] = 1000 - acc
                else:
                    w = int(round(scores[k] * 1000.0 / total))
                    if w < 0:
                        w = 0
                    weights[k] = w
                    acc = acc + w
                t = t + 1

        return {
            "inquiry_id": inquiry_id,
            "ready": True,
            "weights": weights,
            "scores": scores,
            "note": "deterministic milli-shares",
        }
