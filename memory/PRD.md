# Fresh Start (formerly FridgeChef) – PRD

## Original problem statement
A meal plan app where you take a photo of your fridge and pantry and AI scans the food you have to make meal plans using budget, household size and the cooking appliances the user has. An all-in-one app that turns food already in your kitchen into affordable weekly meal plans and shopping lists. Target: families, students, busy households. Family mode for allergies and dietary restrictions. Prioritizes ingredients about to expire and builds meals around them. Scans leftovers and suggests new, non-repeated meals. Possible points/rewards system.

## User choices
- AI: Gemini 3 Flash (gemini-3-flash-preview) via Emergent LLM key
- Auth: Email/password (JWT, bcrypt)
- MVP: all core features except points/rewards (deferred)
- Theme: pink, yellow and white (Fredoka + Nunito)

## Architecture
- Backend: FastAPI + MongoDB (`/app/backend/server.py`), emergentintegrations for Gemini (with a 1-request lock and retry/backoff), Emergent Object Storage for scan photos
- Frontend: Expo Router, tabs (Home / Pantry / Plan / Shop; NativeTabs on iOS 26+), modal Scan, Recipe detail, Profile/onboarding
- Plan generation runs in the background; the client polls `/api/plans/current`

## Implemented (2026-11-12)
- Register/login/me, onboarding (household size, budget + currency, appliances, family mode with allergies and diets)
- Pantry CRUD, search, category chips, expiry tags
- Fridge/pantry photo scan → review/edit → bulk add with AI-estimated expiry
- Leftover photo scan → 3 new recipes that avoid recently used meal titles
- 7-day × 3-meal AI plan that uses expiring items first, respects the budget, appliances, allergies and diets, and gives cost estimates and tips
- Auto shopping list grouped by aisle; check off, add manual items, clear checked (regenerating keeps manual items)
- Camera permission flow with an Open Settings fallback

## Backlog
- P1: Points/rewards (for cooking planned meals and using expiring food)
- P1: Mark a meal as cooked → deduct its ingredients from the pantry
- P2: Swap a single meal, share the shopping list, household members
- P2: Expiry reminders

## v2 (2026-11-24): rename + rewards
- Renamed to Fresh Start with the user's pomegranate logo (assets/images/logo-*.png, plus the app icon)
- Points, weekly quests, badges and levels (/rewards); shareable shopping link that anyone can tick (/api/share/{token})

## v3 (2026-11-25): connected planner
- Plan tab: Day/Week view; Breakfast/Lunch/Snack/Dinner sections; AI meals can be accepted, declined or moved; manual meals use the same card; swap with feedback
- Plan My Week / Plan My Day × Only my pantry / Pantry + new ingredients; read-only phone calendar busy times (native only)
- Two generators: craving (/craving) and pick-ingredients (/cook-with, also reached from a pantry item's "Use in a meal")
- Recipe detail: pantry vs buy groups, macros per serving, favourites, "I ate this" with servings (logs once, updates instead of duplicating), and cook (AI deducts partial pantry quantities)
- Shopping: merged items with needed_for, top-up vs missing, AI-estimated prices across preferred stores (Walmart, Fortinos, Sobeys, No Frills, Longos, Costco), running total vs budget, bought → pantry
- Food log: AI serving-size suggestion; 15 units with live macro recalculation
- Note: the user chose live Kroger prices, but Kroger's API covers US stores only and none of their Canadian stores, so prices are AI estimates

## Backlog
- P1: Real grocery price API for Canadian stores (e.g. a PC Express/Instacart partner, if available)
- P1: Split server.py into modules
- P2: Nutrition goals per person; weekly nutrition chart
