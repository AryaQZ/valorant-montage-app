
"""Find review-only shots when a VALORANT replay lacks player feed accents."""

import json
from pathlib import Path
import sys



def _persistent_step(glyphs, index):
    import numpy as np

    before, after = glyphs[index - 3:index], glyphs[index:index + 3]
    left, right = np.median(before, axis=0), np.median(after, axis=0)
    change = np.abs(left - right).mean()
    variation = max(np.abs(before - left).mean(axis=(1, 2)).max(),
                    np.abs(after - right).mean(axis=(1, 2)).max())
    return change >= 0.035 and change >= 3 * variation


def _review_ammo_step(detector, profile, shot):
    import numpy as np

    impact = shot["K"]
    min_lag, max_lag = profile["lag"]["feed_frames"]
    alternatives = [n for n in shot["changes"] if
                    min_lag <= shot["feed"] - n <= max_lag and 3 <= n < impact]
    if not alternatives:
        return shot
    start, end = min(alternatives) - 3, impact + 2
    if end >= detector.clipio.n_frames("c1"):
        return shot
    x, y, width, height = profile["ammo"]["region"]
    images = detector.read("c1", start, end)
    glyphs = (images[:, y:y + height, x:x + width].min(axis=3) >= 190).astype(np.float32)
    if _persistent_step(glyphs, impact - start):
        return shot
    sustained = [n for n in alternatives if _persistent_step(glyphs, n - start)]
    if len(sustained) != 1:
        return shot
    corrected = sustained[0]
    return {**shot, "K": corrected, "K_was": impact, "conf": "medium", "method": "persistent-ammo",
            "frame_correction": {"from": impact, "to": corrected,
                                 "reason": "Earlier ammo glyph change persists for three frames."}}


_CONF_ORDER = {"high": 3, "medium": 2, "low": 1, "guess": 0}


def _replay_team_order(detector, frame, own):
    import cv2
    import numpy as np

    default_order = list(own.get("order") or ["teal", "red"])
    specs = {mask["name"]: mask for mask in own.get("masks", [])}
    if "teal" not in specs or "red" not in specs:
        return default_order
    # In VALORANT replays, the bottom-left spectator player card carries the
    # spectated player's team accent (teal on defender half, red on attacker half).
    card = frame[780:960, 0:420]
    if card.size == 0:
        return default_order
    hsv = cv2.cvtColor(np.ascontiguousarray(card), cv2.COLOR_RGB2HSV)
    teal_px = int(detector.mask_of(hsv, specs["teal"]).sum())
    red_px = int(detector.mask_of(hsv, specs["red"]).sum())
    if red_px >= 400 and red_px > 3 * teal_px:
        return ["red", "teal"]
    return default_order


def _shot_rank(shot):
    return (
        1 if shot.get("verified") else 0,
        _CONF_ORDER.get(str(shot.get("conf", "guess")).lower(), 0),
        1 if shot.get("how") == "ammo" else 0,
        -(int(shot.get("feed", 0))),
    )


def _deduplicate_shots(shots, *, shot_gap=15, feed_gap=6):
    """Collapse duplicate rows caused by scrolled/flickering replay kill-feed bands."""
    ordered = sorted(shots, key=lambda item: (int(item["K"]), int(item.get("feed", item["K"]))))
    kept = []
    for shot in ordered:
        duplicate_index = None
        for idx, existing in enumerate(kept):
            same_shot = abs(int(shot["K"]) - int(existing["K"])) <= shot_gap
            same_feed = (
                shot.get("feed") is not None
                and existing.get("feed") is not None
                and abs(int(shot["feed"]) - int(existing["feed"])) <= feed_gap
            )
            if same_shot or same_feed:
                duplicate_index = idx
                break
        if duplicate_index is None:
            kept.append(shot)
        elif _shot_rank(shot) > _shot_rank(kept[duplicate_index]):
            kept[duplicate_index] = shot
    return kept


def main(scripts: str) -> None:
    sys.path.insert(0, scripts)
    import kills_auto as detector

    profile = detector.load_profile("valorant")
    feed = profile["feed"]
    own = feed["own"]
    base_masks = [mask for mask in own["masks"] if mask["name"] != "lime"]
    x, _, width, _ = feed["region"]
    onsets = detector.audio_onsets("c1")
    collected = []
    for row in detector.scan_rows("c1", profile):
        if row["own"] or row["counts"]["lime"] >= own["masks"][0]["min_px"]:
            continue
        number = min(row["onset"] + 3, detector.clipio.n_frames("c1") - 1)
        image = detector.read("c1", number, number)[0]
        team_order = _replay_team_order(detector, image, own)
        team_rule = {**own, "masks": base_masks, "order": team_order}
        ordered, _ = detector.own_row_ok(image[row["y0"]:row["y1"], x:x + width], team_rule)
        if not ordered:
            continue
        shot = detector.find_shot("c1", row, profile, onsets)
        if shot["how"] != "ammo" or not shot["verified"]:
            continue
        shot = _review_ammo_step(detector, profile, shot)
        visible = detector.visibility("c1", shot["K"], profile)
        if visible["hidden"]:
            continue
        collected.append({**shot, "clip": "c1", "game": "valorant",
                          "review_ownership": True, "visible": visible})
    deduped = _deduplicate_shots(collected)
    results = {str(index): item for index, item in enumerate(deduped)}
    Path("kills.json").write_text(json.dumps(results, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1])
