BS"D
Intro create a system where a user can call in on a phone number and order products via phone from Amazon and at a later stage also from other sites and marketplaces.
Site should be built using React and Node and use Supabase for the data base ✅ DONE
For the phone system integration we will use Twillio https://www.twilio.com/docs ✅ DONE
For the getting product details and placing orders through Amazon we will not use the Amazon Api directly, rather we will do so through RYE  https://docs.rye.com/api-v2/introduction ✅ DONE
Should use google address api to validate address when they are being entered ✅ DONE (validate-after-entry; no autocomplete/suggestions on phone)

Goal: Create a simple minimal version #1 MVP that can be launched to production and start generating income, market presence and experience. It should be built with future functionality expansion in mind. Later on we can add all types of more features.

Plan:
•	Users will be using Kosher Phones with audio only. ✅ DONE
•	They will be verbally interacting with the 'Twillio Audio Frontend'  which will receive and pass data to/from the 'VoiceX Server' ✅ DONE
•	'VoiceX Server' will pass and receive data to/from the 'RYE API' ✅ DONE
•	'RYE API' will complete the order on Amazon ✅ DONE
•	All admin edits and configurations will be done on the 'VoiceX Server Admin Portal'. ✅ DONE

Flow:
•	User will call in to the main 'VoiceX Phone Number' ✅ DONE
•	Twillio will pass user's phone number to 'VoiceX Server' to check if there is an active account. ✅ DONE
•	If there is an active account user is redirected to 'Password Stage'. ✅ DONE (PIN-based)
•	If there is no active account, user is redirected to 'Create Account Stage'. User has to provide; Name, Email, Password, At least one address, At least one credit card ⚠️ PARTIAL — Name and PIN captured; Email, Address, and Credit Card are NOT collected during registration
•	Once logged in, user can add a product to the cart using a 'Catalog Number' ✅ DONE
•	When a 'Catalog Number' is entered, system repeats the product name and price. User can select to hear its description, full details and reviews. After confirmation, product gets added to cart with the Qty selected by user.. ⚠️ PARTIAL — Name/price readback and add-to-cart work; description now auto-fetched from Rye at product-add time and readable via "More Details"; reviews still stubbed
•	User can access cart and hear a total of how many product types are in cart, total QTY of products and total cart price (ex:  5 products with total qty of 13 and a total cart price of $150). User can listen to all the products found in cart. He can delete products and edit their Qty. ✅ DONE
•	User can then move to checkout, where he can select one of his saved addresses or add a new one. He can select a saved credit card or add a new one. ✅ DONE
•	User can complete the checkout. If order is not eligible for free Prime shipping, it will tell him the shipping cost and the updated cart total. ⚠️ PARTIAL — Checkout works; shipping cost is applied by Rye in background but NOT communicated to user in voice summary before placing order
•	User can access a simple history of his orders. For now just order ID, order date and current order status. ✅ DONE (uses index-based selection instead of Order ID entry)

Assumptions
•	Twillio can handle the following..
o	Voice detection (user can say options instead of pressing numbers) ✅ DONE (speech hints configured in gathers)
o	Voice matching (if user says 'buy products', it should know he meant 'shopping' ✅ DONE (speech-normalizer.ts maps synonyms)
o	Can spell things out like emails  j o h n d o e @gmail.com ❌ PENDING — Email not collected during registration
•	Rye
o	Allows us to pass a markup to product price. It will charge card for the marked up price but only sends Amazon their price. ✅ DONE (markup logic in shared package)
o	Allows checkout of multiple products and quantities ⚠️ PARTIAL — Each cart item processed as separate Rye checkout intent (not single multi-item order)
o	Includes free shipping from Amazon Prime ✅ DONE (Rye handles this)
o	Can pass over description, full details and reviews of any given product ⚠️ PARTIAL — Product name/description/price auto-fetched from Rye via products.lookup at admin add time and stored in DB; "More Details" IVR option reads stored description; reviews still stubbed
o	If an order is not eligible for free Prime shipping, it should pass over the shipping amount. ⚠️ PARTIAL — Shipping stored on order after Rye processes, but not communicated to user before order placement
o	Can pass status of existing orders ✅ DONE (order status stored and readable)

Admin 
1.	User Management
a.	View/add/edit/freeze/delete users and their main data with filter and sort ✅ DONE
b.	Can update a user's password ✅ DONE (PIN update via API)
c.	Can see login history of any user ✅ DONE
d.	Can whitelist a user and then that user will be charged only the base product pricing without any markup. ✅ DONE (whitelist flag in schema + shared pricing logic)
2.	Order Management
a.	View all orders and the products included in them ✅ DONE
b.	Can filter orders via user, date range, or contained product ⚠️ PARTIAL — User and date range filters work; product filter done in-memory after fetch (pagination/totals may be inaccurate)
3.	Settings
a.	Auto mark up default % ✅ DONE
4.	Catalog Category Management
a.	Can add/edit/delete catalog categories ✅ DONE
b.	Can have parent/child categories up to 3 levels deep ✅ DONE (depth constraint enforced)
5.	Catalog Product Management
a.	Add/edit/delete products ✅ DONE
b.	Set category (or multiple categories) ✅ DONE
c.	Set VoiceX ID for each item (Can also be auto generated) ✅ DONE
d.	Set Amazon link/asin for each product for passing to RYE API ✅ DONE (ASIN auto-fetches name, description, price, URL from Rye products.lookup)
e.	Can override product name and description with custom. If empty it will use Amazon data. ✅ DONE (shared getProductDisplayName helper)
f.	Can see lifetime purchase total for each product ✅ DONE (total_sold column + increment RPC)
g.	Product price auto generates using Amazon price plus the default markup % from Settings, but can overwrite to a custom price. ✅ DONE (shared getProductPriceCents helper)
6.	Admin Reports
a.	View and export an excel download of all products purchased in any date range. ✅ DONE
b.	Sort / filter list by date range and qty ⚠️ PARTIAL — Date range filter works; qty sort/filter limited
7.	Functions
a.	Caller Number Detection
i.	Can detect if an account exists for that number and if active or frozen ✅ DONE
b.	Registration
i.	User can pass over Name, Phone, Email, PW ⚠️ PARTIAL — Name and PIN captured; Email NOT collected during IVR registration
c.	Addresses
i.	User can save multiple addresses ✅ DONE
ii.	Addresses can be added at registration or at checkout ⚠️ PARTIAL — Only at checkout, NOT during registration
iii.	For each address can enter: Address, Apt, Street, City, State, Zip ✅ DONE
d.	Credit Cards
i.	User can save multiple credit cards ✅ DONE
ii.	Cards can be entered  at registration or at checkout ⚠️ PARTIAL — Only at checkout via Twilio <Pay>, NOT during registration
iii.	For each have to enter: CC number, date, cvv ✅ DONE (via Twilio <Pay> gather)
e.	Detect Product Availability on Amazon at time it is added to VoiceX cart, with a fallback if out of stock. ❌ PENDING — No stock check via Rye API before adding to cart
f.	Order Status
i.	Can check the status of an existing order ✅ DONE
Here is the IVR Flow

IVR should not be hard coded, rather we should have a management in admin to be able to easily edit the IVR flow so later we can easily add things and make changes…. ⚠️ PARTIAL — DB schema for IVR flows/nodes/edges exists + admin UI for editing, BUT live calls use hardcoded TypeScript handlers (admin-edited flows do NOT execute at runtime)
In all places should either be able to enter option pressing the physical phone key, by saying that number, or by saying that option. So for example  if say either 'One' or say 'Catalog' or press the digit 1, then will go to catalog " ✅ DONE (speech + DTMF input configured)

1. Call Initiation & User Identification
When a user calls the hotline, the system triggers the Check User API using the caller ID.
The API validates:
•	Whether the user exists ✅ DONE
•	Whether the account is active or frozen ✅ DONE
API Response Handling:
•	If account is frozen 
o	Play: "Your account is currently restricted. Please contact support." ✅ DONE
o	Call is terminated ✅ DONE
•	If user exists →: ValidatePIN ✅ DONE
•	If new user → : Register ✅ DONE
________________________________________
2. PIN Validation Flow (Existing Users)
•	User enters 4-digit PIN (DTMF) ✅ DONE
•	If pin is correct then it should right away redirect to Main Menu, no need for confirmation. Only if wrong it should ask customer to renter PIN ✅ DONE
Flow:
•	1 → Main Menu ✅ DONE
•	2 → Repeat PIN entry ✅ DONE
________________________________________
3. User Registration Flow (New Users)
Step 1: Capture Name
•	User speaks name followed by # ✅ DONE
•	System reads back ( Best if reads full name and then repeats it again letter by letter) ⚠️ PARTIAL — Reads back name; letter-by-letter readback not confirmed
•	Confirmation:
o	Press 1 to confirm ✅ DONE
o	Press 2 to reenter ✅ DONE
________________________________________
Step 2: Set PIN
•	User enters PIN (DTMF) ✅ DONE
•	System reads back ✅ DONE
•	Confirmation:
o	Press 1 to confirm ✅ DONE
o	Press 2 to re-enter ✅ DONE
________________________________________
4. Main Menu
Prompt:
 -   Say or Press: 1 for Catalog,- ✅ DONE
-  2 for Cart ✅ DONE
- 3 for Order Status ✅ DONE
(So for example if say either 'One' or say 'Catalog' or press the digit 1, then will go to catalog "Say Catalog, Cart, or Orders) ✅ DONE
Routing:
•	Catalog → Product flow ✅ DONE
•	Cart → Cart flow ✅ DONE
•	Order Status → Orders flow ✅ DONE
•	Returns > this is a dummy static option, if selected it will just replay main menu again ✅ DONE
________________________________________
5. Catalog Flow
Step 1: Catalog ID Input
•	User enters Catalog ID (DTMF) ✅ DONE
•	it should right away do an API look up and read the product name from our server ✅ DONE

Confirmation:
o	Press 1 or say Add to Cart ✅ DONE
o	Press 2 or say More Details ✅ DONE (description auto-fetched from Rye at product-add time, stored in amazon_description, read back on call)
o	Press 3 or say Get Reviews ⚠️ PARTIAL — Option exists but Rye API not called for real reviews
o	Press 4 or say Another Product ✅ DONE
o	Press * or say Back to Main Menu ✅ DONE
•	Product Lookup API called (we already called the VoiceX API to get the product name. Can now call the RYE API to get details and reviews if requested) ⚠️ PARTIAL — VoiceX lookup works; Rye product data (name, description, price) auto-fetched at admin add time via products.lookup; reviews not implemented
If not found:
•	Retry Catalog ID input ✅ DONE
________________________________________
Step 2: Add to Cart (Sequential Input)
•	User enters quantity (DTMF) ✅ DONE
•	System reads back quantity ✅ DONE
•	Confirmation:
o	Press 1 to confirm ✅ DONE
o	Press 2 to re-enter ✅ DONE
•	Stock API check ❌ PENDING — No stock check via Rye before adding to cart
If available:
•	Add to cart ✅ DONE
•	Read confirmation ✅ DONE
o	Press 1 or say Add Another Product ✅ DONE
o	Press 2 or say Checkout (will take them to cart) ✅ DONE
o	* or say Main Menu ✅ DONE
If not:
•	Inform user  (Lets say he enters 5 qty and there are only 3, will it give him a message that there are at least 3 available ) ❌ PENDING — No stock availability check or partial availability messaging
•	
________________________________________
6. Cart Flow
Step 1: Cart Summary
System reads:
•	Total items ✅ DONE
•	Quantity ✅ DONE
•	Amount ✅ DONE
________________________________________
Step 2: Actions

1 - There should be an option to play back a list of all the items ✅ DONE

2 - Also add option skip to checkout ✅ DONE
3 - Change Item
•	Enter Catolog ID (DTMF) ✅ DONE
•	Confirm (1 / 2) ✅ DONE
•	Enter Quantity (DTMF) ✅ DONE
•	Confirm (1 / 2) ✅ DONE
•	Update API ✅ DONE
________________________________________
4 - Remove Item
•	Enter Catalog ID (DTMF) ✅ DONE
•	Confirm selection (1 / 2) ✅ DONE
•	Confirm removal:
o	Press 1 to remove ✅ DONE
o	Press 2 to cancel ✅ DONE
________________________________________
7. Checkout Flow
________________________________________
Step 1: Address Entry – We need google address api to make sure all the address are legit and to give auto suggest ⚠️ PARTIAL — Google Address Validation API integrated (validate-after-entry); no auto-suggest on phone
Each field is entered 
1.	Enter House/Street Number ✅ DONE
2.	Enter Street Name and apt (numeric keypad mapping if needed) ✅ DONE
3.	Enter City ✅ DONE
4.	Enter State ✅ DONE
5.	Enter ZIP Code ✅ DONE
After all fields:
•	System reads full address ✅ DONE
•	Final confirmation:
o	Press 1 to confirm ✅ DONE
o	Press 2 to restart address entry ✅ DONE
•	Address saved via API ✅ DONE
•	If there is an address already in system for that user, it will ask him if he wants to use it or if he wants to enter in a new one. ✅ DONE
________________________________________
Step 2: Payment Method (Sequential Input)
All card inputs are manual (DTMF only)
1.	Enter Card Number ✅ DONE (via Twilio <Pay>)
o	Confirm (1 / 2) ✅ DONE
2.	Enter Expiry Date ✅ DONE (via Twilio <Pay>)
o	Confirm (1 / 2) ✅ DONE
3.	Enter CVV ✅ DONE (via Twilio <Pay>)
o	Confirm (1 / 2) ✅ DONE
•	System reads masked card ✅ DONE
•	Final confirmation:
o	Press 1 to confirm ✅ DONE
o	Press 2 to re-enter ✅ DONE
•	Tokenization API called ✅ DONE (Stripe via Twilio <Pay>)
•	
________________________________________
Step 3: Order Summary
•	System computes total and delivery estimate ⚠️ PARTIAL — Total computed; delivery estimate not populated
•	If there is any shipping charge, it should mention it here ❌ PENDING — Shipping charge applied by Rye after order placement, not communicated to user before confirming
Prompt:
 "Your total is [amount]. Estimated delivery is [date]." ⚠️ PARTIAL — Total shown; estimated delivery date not available
________________________________________
Step 4: Confirmation
•	Press 1 → Place Order ✅ DONE
•	Press 2 → Cancel ✅ DONE
Flow:
•	Confirm → Order placed → Success message ✅ DONE
•	Cancel → Return to Cart ✅ DONE
________________________________________
8. Orders Flow
Step 1: Orders List
•	System reads recent orders ✅ DONE
________________________________________
Step 2: Order Details
•	Enter Order ID (DTMF) ⚠️ PARTIAL — Uses index-based selection (e.g. "press 1 for first order") instead of entering actual Order ID
•	System reads back ✅ DONE
•	Fetch and read details ✅ DONE
________________________________________
9. Timeout and Input Handling
•	Each step has a default timeout ✅ DONE (configurable call_timeout_seconds in settings)
If no input:
•	System reprompts ✅ DONE
After repeated failures:
•	Call is terminated gracefully ✅ DONE


========================================
STATUS SUMMARY
========================================

FULLY DONE (✅):  ~72% of spec items
- React + Node + Supabase stack
- Twilio phone integration (inbound calls, DTMF + speech input)
- Rye API integration for checkout + product data lookup
- Google Address Validation API
- Admin portal (users, products, categories, orders, settings, reports)
- User management (CRUD, PIN, login history, whitelist)
- Catalog management (categories, products, VoiceX IDs, pricing)
- ASIN auto-fetch: admin enters ASIN, system pulls name/description/price/URL from Rye
- Product "More Details" on IVR reads real Amazon description (auto-fetched at add time)
- Settings (markup %)
- Call initiation & user identification (active/frozen/new)
- PIN validation flow
- Registration flow (name + PIN only)
- Main menu with speech + DTMF routing
- Catalog ID lookup from VoiceX DB
- Add to cart with qty selection
- Full cart flow (summary, list items, change qty, remove)
- Full checkout flow (address entry, payment via Twilio <Pay>, order placement)
- Orders flow (list + detail view)
- Reports (date range + Excel export)
- Timeout handling & graceful termination

PARTIALLY DONE (⚠️):  ~19% of spec items
- Registration missing Email, Address, Credit Card collection
- Product reviews from Rye API still stubbed (description now works)
- Shipping cost not communicated to user before order confirmation
- IVR flow admin DB schema + UI exists but does NOT drive live calls (hardcoded handlers)
- Order filtering by product is in-memory (pagination issues)
- Reports qty sort/filter limited
- Order details use index selection instead of Order ID DTMF entry
- Delivery estimate not populated in order summary
- Multi-item orders processed as separate Rye intents (not single multi-item checkout)
- Name readback letter-by-letter during registration not confirmed

NOT STARTED (❌):  ~9% of spec items
- Stock/availability check via Rye API before adding to cart
- Partial availability messaging ("only 3 available")
- Shipping cost shown to user before placing order
- Product reviews fetched from Rye API
- Email collection during registration
