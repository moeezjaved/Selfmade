-- Clone/edit are Pro-only (Nano Banana Pro @ 2K ≈ $0.21/image measured). Reprice for a healthy
-- ~2× margin at ~$0.018/credit. Standard tiers kept but unused by the UI now.
update credit_pricing set credits = 20, is_active = true where action_type = 'image_clone_pro';
update credit_pricing set credits = 12, is_active = true where action_type = 'image_edit_pro';
