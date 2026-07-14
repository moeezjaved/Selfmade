-- Image clone price fix — the modal has always SHOWN 2K = 15 cr / 4K = 25 cr (hardcoded in
-- CloneModal), but credit_pricing carried the pre-redenomination 100 / 160. reserve_credits reads
-- the table, so users were QUOTED 15 and CHARGED 100. Moeez confirmed 15 / 25 is the intended price
-- (1 credit = 1¢ → $0.15 / $0.25). Bring the table down to match what the UI promises.
UPDATE credit_pricing SET credits = 15 WHERE action_type = 'image_clone_pro';
UPDATE credit_pricing SET credits = 25 WHERE action_type = 'image_clone_4k';
