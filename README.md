# MediTrack

MediTrack is a local-first diabetes health record for blood glucose, food, nutrition, hydration, and exercise. It provides trend visualization and evidence-aligned decision support without diagnosing conditions or calculating insulin doses.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`. MediTrack is a static, offline-capable web app (PWA). There is no server or cloud database: records are stored in the browser's IndexedDB on the device itself. Optional: set `NEXT_PUBLIC_USDA_API_KEY` in `.env.local` to use a private [USDA FoodData Central key](https://fdc.nal.usda.gov/api-key-signup.html); the shared `DEMO_KEY` has strict rate limits. The key is bundled into the site, so use a free key that is not tied to anything sensitive.

## Put it on an iPhone

The user's health data never leaves her phone, and the developer never sees it. The hosting site only serves the app's code.

1. Build: `npm run build` (use `NEXT_PUBLIC_USDA_API_KEY=... npm run build` for a private food-search key). This creates the static site in `out/`.
2. Host the built site over HTTPS (required for install/offline on iOS).
   - **GitHub Pages (recommended):** push this repo to a **public** GitHub repository, then in the repo go to **Settings → Pages → Build and deployment → Source: GitHub Actions**. The included workflow (`.github/workflows/deploy.yml`) builds and publishes the site on every push to `main` or `master`. The app will be at `https://<your-username>.github.io/<repo-name>/`. For a private food-search key, add a repository secret named `USDA_API_KEY` (Settings → Secrets and variables → Actions). Free GitHub accounts can only publish Pages from public repos; the repo contains only source code, never health data.
   - **Other hosts:** drag the `out` folder onto Netlify Drop, or use Cloudflare Pages / Vercel with build command `npm run build` and output directory `out`. If the site is served from a sub-path, set `NEXT_PUBLIC_BASE_PATH` (for example `/MediTrack`) when building.
3. On the iPhone, open the link in **Safari** (not Chrome), tap **Share → Add to Home Screen**, and open MediTrack from the new icon.
4. Use the **Back up** button regularly. Data is erased if the app is deleted or Safari website data is cleared, and iOS can remove data from sites that are not installed to the Home Screen.

After the first load, the app works offline except for USDA food search. Data from the browser/localhost version is separate from the installed phone app. To regenerate the app icons, run `npm run icons`.

## Clinical basis and boundaries

- Common glucose targets shown in the app are ADA targets for most nonpregnant adults: 80–130 mg/dL before meals and under 180 mg/dL 1–2 hours after beginning a meal. Targets must be individualized.
- Hypoglycemia guidance uses the ADA 15-15 rule below 70 mg/dL. A value below 54 mg/dL is treated as clinically significant hypoglycemia requiring immediate action.
- At 250 mg/dL or above, the app advises ketone checking and use of the patient’s prescribed sick-day/correction plan. Emergency escalation depends on ketones and symptoms such as vomiting, breathing difficulty, confusion, or inability to retain fluids.
- Estimated A1C uses the ADAG equation: `eAG (mg/dL) = 28.7 × A1C − 46.7`. It is only meaningful with enough representative glucose data and is not a laboratory result.
- Meal assessments are serving-level heuristics based on carbohydrate, fiber, protein, saturated fat, and sodium. They do not predict an individual glucose response or classify foods as universally good or bad. Pair meals with pre-meal and 1–2-hour post-meal readings for useful personal evidence.
- Nutrition values are sourced from USDA FoodData Central. Branded entries may report nutrients per 100 g or per labeled serving; users must verify serving units.
- **Predicted glucose impact** links a logged meal (still "active" within ~3.5 hours) to your most recent glucose reading and projects a range, not a single number. It computes "available carbohydrate" (total carbohydrate minus fiber, since fiber is not absorbed and does not directly raise glucose), moderates the projected rise for protein and fat content (which slow gastric emptying and blunt/delay the glucose peak), and applies a commonly cited educational estimate of ~3–5 mg/dL glucose rise per gram of available carbohydrate in adults. The projection uses a simplified triangular model peaking around 90 minutes and returning toward baseline by ~3.5 hours, consistent with ADA guidance to check glucose 1–2 hours after eating. If the projected range reaches 250 mg/dL or 300 mg/dL, the app surfaces the same ketone-check/very-high guidance used elsewhere, and separately flags low same-day fluid intake alongside elevated glucose — dehydration concentrates blood glucose and is a hallmark of hyperosmolar hyperglycemic state (HHS), a diabetic emergency treated with IV fluids. This feature is an educational estimate only: it does not account for insulin, medication, activity, or individual insulin sensitivity, is not personalized insulin-dosing guidance, and does not replace an actual glucose check.
- **Exercise & glucose connection** relates a logged workout (type, intensity, duration, optional body weight) to blood glucose using established exercise physiology. Aerobic and resistance exercise increase insulin-independent, contraction-mediated (GLUT4) muscle glucose uptake and typically *lower* glucose during and for hours afterward. High-intensity/anaerobic effort triggers a catecholamine (epinephrine/norepinephrine) surge that can *transiently raise* glucose via increased hepatic glucose output, usually followed by a larger delayed drop as insulin sensitivity improves. Calories burned use the standard ACSM metabolic formula (`kcal = MET × 3.5 × weight(kg) / 200 × minutes`) with MET values from the Compendium of Physical Activities. Pre-exercise guidance follows the ADA/ACSM position statement's blood-glucose thresholds (e.g., under 90 mg/dL: eat carbohydrate first; above 270 mg/dL: check ketones before exercising). The app also flags delayed-onset hypoglycemia risk, a well-documented effect of exercise that can persist up to 24 hours, especially for those on insulin or a sulfonylurea. This is an educational estimate only, not personalized insulin, medication, or exercise-prescription guidance.

Primary references: [ADA glucose monitoring targets](https://diabetes.org/living-with-diabetes/treatment-care/checking-your-blood-sugar), [ADA hypoglycemia guidance](https://diabetes.org/living-with-diabetes/treatment-care/hypoglycemia), [ADA ketone guidance](https://diabetes.org/about-diabetes/complications/ketoacidosis-dka), [USDA FoodData Central](https://fdc.nal.usda.gov/api-guide.html), Nathan et al., *Diabetes Care* 2008, doi:10.2337/dc08-0545, Gannon & Nuttall (protein and glycemic response), *Diabetes Care* 2004, ADA/AACE hyperosmolar hyperglycemic state management guidance, Richter & Hargreaves, "Exercise, GLUT4, and Skeletal Muscle Glucose Uptake," *Physiol Rev* 2013, Marliss & Vranic, "Intense Exercise Has Unique Effects on Both Insulin Release and Its Roles in Glucoregulation," *Diabetes* 2002, Colberg et al., "Physical Activity/Exercise and Diabetes: A Position Statement of the American Diabetes Association," *Diabetes Care* 2016, and the Compendium of Physical Activities (Ainsworth et al., *Med Sci Sports Exerc* 2011).

## Production requirements

This MVP stores one local profile on the user's own device without authentication. Before handling real protected health information in a hosted multi-user environment, add authenticated multi-user tenancy, encryption and key management, audit logging, consent and retention controls, backups, accessibility testing, clinician review, and the privacy/security controls required by the applicable jurisdiction. Do not market the risk rules as diagnosis or treatment without regulatory review.