"""Deploy the Newintel judge to GenLayer Studio with genlayer-py (no Node CLI)."""

import os
import sys
import time
from pathlib import Path

from eth_account import Account
from genlayer_py import create_client, studionet
from genlayer_py.types.transactions import TransactionStatus


def main() -> int:
    key = os.environ.get("GENLAYER_PRIVATE_KEY", "").strip()
    if not key:
        print("GENLAYER_PRIVATE_KEY missing", file=sys.stderr)
        return 1
    if not key.startswith("0x"):
        key = "0x" + key
    account = Account.from_key(key)
    rpc = os.environ.get("GENLAYER_RPC", "https://studio.genlayer.com/api")
    print(f"deployer={account.address} rpc={rpc}", file=sys.stderr)

    client = create_client(chain=studionet, account=account)
    code = Path(__file__).resolve().parents[1] / "contracts" / "NewintelContributionJudge.studionext.py"
    source = code.read_text()
    print(f"contract={code} bytes={len(source)}", file=sys.stderr)

    tx_id = client.deploy_contract(code=source, args=[])
    print(f"tx_id={tx_id}", flush=True)

    # Studio can take a while under consensus. Wait for ACCEPTED then FINALIZED.
    for status in (TransactionStatus.ACCEPTED, TransactionStatus.FINALIZED):
        try:
            rec = client.wait_for_transaction_receipt(
                tx_id, status=status, interval=4000, retries=40
            )
            print(f"status={status} rec={rec}", flush=True)
        except Exception as e:
            print(f"wait {status} failed: {e}", flush=True)
            break

    # Contract address is the tx recipient / created contract for deploys.
    try:
        receipt = client.get_transaction_receipt(tx_id)
        print(f"receipt_keys={list(receipt.keys()) if isinstance(receipt, dict) else type(receipt)}", flush=True)
        print(receipt, flush=True)
    except Exception as e:
        print(f"receipt failed: {e}", flush=True)

    # Try reading a view on common address fields
    for field in ("contractAddress", "to", "recipient"):
        try:
            addr = getattr(receipt, field, None) if not isinstance(receipt, dict) else receipt.get(field)
            if addr:
                print(f"{field}={addr}", flush=True)
                try:
                    n = client.read_contract(address=addr, function_name="get_payout_hook", args=[])
                    print(f"get_payout_hook -> {n!r}", flush=True)
                except Exception as e:
                    print(f"read failed: {e}", flush=True)
                break
        except Exception:
            continue
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
