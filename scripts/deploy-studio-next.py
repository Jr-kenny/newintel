"""Deploy the Newintel judge to Studio Next (chain 61997) with genlayer-py."""

import copy
import os
import sys
import time
from pathlib import Path

from eth_account import Account
from genlayer_py import create_client, studionet
from genlayer_py.types.transactions import TransactionStatus


def studio_next_chain():
    """Clone studionet, retarget to Studio Next preview (61997)."""
    chain = copy.deepcopy(studionet)
    chain.id = 61997
    chain.name = "GenLayer Studio Next"
    chain.rpc_urls = {"default": {"http": ["https://studio-dev.genlayer.com/api"]}}
    chain.block_explorers = {
        "default": {
            "name": "Studio Next Explorer",
            "url": "https://explorer-studio-dev.genlayer.com",
        }
    }
    return chain


def main() -> int:
    key = os.environ.get("GENLAYER_PRIVATE_KEY", "").strip()
    if not key:
        print("GENLAYER_PRIVATE_KEY missing", file=sys.stderr)
        return 1
    if not key.startswith("0x"):
        key = "0x" + key
    account = Account.from_key(key)
    chain = studio_next_chain()
    print(f"deployer={account.address} chain={chain.id} rpc={chain.rpc_urls}", file=sys.stderr)

    client = create_client(chain=chain, account=account)
    code_path = Path(__file__).resolve().parents[1] / "contracts" / "NewintelContributionJudge.studionext.py"
    source = code_path.read_text()
    if "Depends" not in source.splitlines()[0]:
        print("FATAL: first line must be the py-genlayer Depends header", file=sys.stderr)
        return 1
    print(f"contract={code_path} bytes={len(source)}", file=sys.stderr)

    # Studio Next consensus may require a fee deposit. The default client
    # sends value=0, which reverts with FeeValueMustBeNonZero / invalid fee.
    from genlayer_py.contracts import actions as gl_actions

    original = gl_actions._send_transaction
    fee_wei = int(os.environ.get("STUDIO_NEXT_FEE_WEI", "50000000000000000"))  # 0.05 GEN

    def send_with_fee(self, encoded_data, sender_account=None, value=0, sim_config=None):
        print(f"sending with fee_value={fee_wei}", file=sys.stderr)
        return original(self, encoded_data, sender_account=sender_account, value=fee_wei, sim_config=sim_config)

    gl_actions._send_transaction = send_with_fee
    tx_id = client.deploy_contract(code=source, args=[])
    print(f"tx_id={tx_id}", flush=True)

    for status in (TransactionStatus.ACCEPTED, TransactionStatus.FINALIZED):
        try:
            rec = client.wait_for_transaction_receipt(tx_id, status=status, interval=4000, retries=40)
            print(f"status={status}", flush=True)
            data = rec.get("consensus_data") if isinstance(rec, dict) else None
            if data:
                leader = (data.get("leader_receipt") or [{}])[0]
                print(f"leader_execution={leader.get('execution_result')} result={leader.get('result')}", flush=True)
            print(f"to={rec.get('to_address') if isinstance(rec, dict) else rec}", flush=True)
        except Exception as e:
            print(f"wait {status} failed: {e}", flush=True)
            break

    try:
        receipt = client.get_transaction_receipt(tx_id)
        addr = receipt.get("to") if isinstance(receipt, dict) else getattr(receipt, "to", None)
        print(f"contract_address={addr}", flush=True)
        if addr:
            try:
                hook = client.read_contract(address=addr, function_name="get_payout_hook", args=[])
                print(f"get_payout_hook -> {hook!r}", flush=True)
                print(f"EXPLORER https://explorer-studio-dev.genlayer.com/address/{addr}", flush=True)
            except Exception as e:
                print(f"read failed: {e}", flush=True)
    except Exception as e:
        print(f"receipt failed: {e}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
