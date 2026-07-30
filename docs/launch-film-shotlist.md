# Selfmade launch film — master playbook

A Cofounder-style launch film: one founder, a wildflower meadow, phone-call dialogue, product UI on the laptop.
~90 seconds. Built with AI stills (Nano Banana) → animated (Seedance/Veo) → UI composited → edited.
End line: **"Run your entire marketing with AI."**

## LOCKED look (2026-07)
- **Outfit:** black t-shirt, blue jeans, white sneakers, an Apple Watch, and a silver dog-tag chain necklace.
- **Reference setup:** `me1.jpg me2.jpg me3.jpg` (clear front-facing selfies) + `hero.png` (the approved Shot 1) → attach all four to every command for face + outfit lock.
- **Style suffix (in every prompt):** *35mm film, golden-hour light, shallow depth of field, film grain, 2.35:1 anamorphic, dreamy A24 aesthetic.*

## Face-fix recipe (if a face looks off)
Don't regenerate — correct the face on the finished frame:
```
python3 generate.py "Keep this first image exactly the same — pose, outfit, meadow, lighting, composition. ONLY replace the man's face to exactly match the face in the other reference photos: same eyes, nose, mouth, jaw, bone structure. Photorealistic, natural, sharp. Change nothing else." shotN.png me1.jpg me2.jpg me3.jpg && mv out_1.png shotN_fixed.png
```
Use the **Pro model** for the face close-up: `export NB_MODEL="<pro image id from AI Studio>"`. Wides have tiny faces — don't over-fix; they won't read at video scale.

## Shot legend
🎞️ animate this still afterward · 🖥️ laptop shot, screen blank on purpose (composite UI later) · 📷 optional real shot of you.

## The 14 shot commands (outfit baked in — append `hero.png` after `me3.jpg` once you have it)
1. Title/lying 🎞️ — man lying back in meadow, tiny in frame, arms behind head, facing sky.
2. Walking away 🎞️📷 — back to camera, phone to ear, small in frame.
3. Desk in field 🎞️ — wooden desk + open laptop in the meadow, man approaching from behind.
4. Laptop close: Discovery 🖥️ — blank light-grey screen, man blurred behind on phone.
5. Laptop close: Brand Spy 🖥️ — 3/4 angle, blank screen, man blurred behind.
6. Mid, side-on 🎞️ — standing side-on, phone to ear, faint smile, laptop in soft-focus foreground.
7. Laptop close: Clone 🖥️ — blank screen, man blurred behind, hand near face on phone.
8. Laptop close: Video 🖥️ — blank screen, no person, slow-push composition.
9. Sitting (dad beat) 🎞️ — sitting on ground beside desk, knees up, phone to ear, contemplative.
10. Laptop close: Mello 🖥️ — blank screen, no person, soft grass + sky behind.
11. Face close-up 🎞️ (Pro) — face, soft meadow behind, wind in hair, small quiet smile, looking off-camera.
12. POV typing 🎞️ — over-shoulder, hands typing, blank screen, meadow beyond.
13. End card 🎞️ — empty meadow, no people, serene. (Add "Selfmade" text in edit.)
14. End card 🎞️ — empty meadow, negative space upper third for text. (Add "Run your marketing with AI".)

Command template (swap the SCENE, keep the rest):
```
python3 generate.py "Use the man in these photos. Keep his exact face, natural realistic, do not alter his face. Cinematic film still: <SCENE>, wearing a black t-shirt, blue jeans, white sneakers, an Apple Watch and a silver dog-tag chain, wildflower meadow, pastel teal sky, 35mm film, golden-hour light, shallow depth of field, film grain, 2.35:1, dreamy A24 aesthetic." me1.jpg me2.jpg me3.jpg hero.png && mv out_1.png shotN.png
```
(For 🖥️ laptop shots add: "open laptop on a wooden desk, screen a plain flat light-grey blank screen facing camera, no glare." For 8/10/13/14 drop the person + face line + reference photos.)

## VO / subtitle script (phone-call device — serif subtitles, lower-center)
| Shot | Line |
|---|---|
| 1 | *(title fades in: **Selfmade**)* |
| 2 | friend: "So what are you building?" → you: "Ads. For online stores." |
| 3 | friend: "You hired a whole team?" → you: "No. It's AI." |
| 4 | *"It finds the ads already winning."* |
| 5 | *"So you never guess what works."* |
| 6 | friend: "Dude, I keep seeing your ads everywhere." → you: "Yeah… it kind of took off." |
| 7 | friend: "Who makes them all?" → you: "I do. Myself." |
| 8 | *"The images, the videos… all of it."* |
| 9 | dad: "Beta… who's running all this for you?" → you: "Nobody, Dad." |
| 10 | dad: "Nobody?" → you: "It's easier now. It's like having a whole team." |
| 11 | dad: "You sound like you mean it." → you: "I do." |
| 12 | *(music swell, no words — hands typing)* |
| 13 | **Selfmade** |
| 14 | **Run your entire marketing with AI.** · tryselfmade.ai |

Voice: ElevenLabs (your voice + distinct dad/friend voices, phone-EQ filter) — or subtitle-only like the original (classier + cheaper). Urdu/English mix on the dad call is a charming option.

## Phase plan
1. **Stills** — generate all 14 (this doc). Face-fix as needed.
2. **Motion** — animate each still in Seedance/Veo: feed the still as the FIRST frame, prompt subtle motion ("gentle wind in grass, slow camera drift, he shifts slightly, 24fps, cinematic"), 3–6s clips.
3. **UI** — screen-record real Selfmade (slowed ~12%), composite onto the blank laptop screens (CapCut "distort"/corner-pin or Resolve corner-pin), add a slow zoom for motion.
4. **Assemble** — VO/subtitles + music (Suno) + teal pastoral grade + serif titles, in DaVinci Resolve or CapCut. 24fps, slow 2–4s cuts, 2.35:1 letterbox. Target 75–100s.

## Cost / time
~$0–100 (Seedance clips + optional ElevenLabs/Suno) · ~2–3 days solo. No location, no shoot (except optional real Shot 2).
