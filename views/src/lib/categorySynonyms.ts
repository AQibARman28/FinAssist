// Maps each default category NAME (lowercase) to common words that imply it.
// Used by parseExpenseInput to guess a category from free text. A synonym only
// resolves if the user actually owns a category with the target name — INC-1
// seeds these 8 defaults, but renamed/removed categories simply won't match,
// in which case the category is left null for the user to pick (this honors
// the "categorization is an explicit choice" principle: we only ever suggest).
//
// Deliberately NOT included: brand names like "netflix"/"spotify" — those are
// classified differently by different users (often Bills), so we leave them
// for the user / the Phase 4 learner rather than guessing wrong.
export const CATEGORY_SYNONYMS: Record<string, string[]> = {
    food: [
        "lunch", "dinner", "breakfast", "brunch", "groceries", "grocery",
        "coffee", "tea", "snack", "snacks", "pizza", "burger", "restaurant",
        "cafe", "meal", "eat", "dining", "food",
    ],
    transport: [
        "uber", "taxi", "cab", "bus", "train", "metro", "tram", "fuel", "gas",
        "petrol", "diesel", "ride", "fare", "parking", "toll", "commute",
        "transport",
    ],
    entertainment: [
        "movie", "movies", "cinema", "game", "games", "concert", "show", "gig",
        "entertainment",
    ],
    shopping: [
        "shopping", "clothes", "clothing", "shoes", "amazon", "mall", "store",
        "gadget",
    ],
    bills: [
        "bill", "bills", "electricity", "electric", "water", "internet", "wifi",
        "rent", "phone", "mobile", "subscription", "utility", "utilities",
    ],
    healthcare: [
        "doctor", "medicine", "medicines", "pharmacy", "hospital", "clinic",
        "health", "healthcare", "dental", "dentist", "medical",
    ],
    education: [
        "book", "books", "course", "courses", "tuition", "school", "college",
        "university", "class", "exam",
    ],
    other: [],
};
