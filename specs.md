BS”D
Intro create a system where a user can call in on a phone number and order products via phone from Amazon and at a later stage also from other sites and marketplaces.
Site should be built using React and Node and use Supabase for the data base
For the phone system integration we will use Twillio https://www.twilio.com/docs
For the getting product details and placing orders through Amazon we will not use the Amazon Api directly, rather we will do so through RYE  https://docs.rye.com/api-v2/introduction
Should use google address api to validate address when they are being entered 

Goal: Create a simple minimal version #1 MVP that can be launched to production and start generating income, market presence and experience. It should be built with future functionality expansion in mind. Later on we can add all types of more features.

Plan:
•	Users will be using Kosher Phones with audio only. 
•	They will be verbally interacting with the ‘Twillio Audio Frontend’  which will receive and pass data to/from the ‘VoiceX Server’ 
•	‘VoiceX Server’ will pass and receive data to/from the ‘RYE API’ 
•	‘RYE API’ will complete the order on Amazon
•	All admin edits and configurations will be done on the ‘VoiceX Server Admin Portal’.

Flow:
•	User will call in to the main ‘VoiceX Phone Number’
•	Twillio will pass user’s phone number to ‘VoiceX Server’ to check if there is an active account.
•	If there is an active account user is redirected to ‘Password Stage’.
•	If there is no active account, user is redirected to ‘Create Account Stage’. User has to provide; Name, Email, Password, At least one address, At least one credit card 
•	Once logged in, user can add a product to the cart using a ‘Catalog Number’ 
•	When a ‘Catalog Number’ is entered, system repeats the product name and price. User can select to hear its description, full details and reviews. After confirmation, product gets added to cart with the Qty selected by user..
•	User can access cart and hear a total of how many product types are in cart, total QTY of products and total cart price (ex:  5 products with total qty of 13 and a total cart price of $150). User can listen to all the products found in cart. He can delete products and edit their Qty.
•	User can then move to checkout, where he can select one of his saved addresses or add a new one. He can select a saved credit card or add a new one.
•	User can complete the checkout. If order is not eligible for free Prime shipping, it will tell him the shipping cost and the updated cart total.
•	User can access a simple history of his orders. For now just order ID, order date and current order status. 

Assumptions
•	Twillio can handle the following..
o	Voice detection (user can say options instead of pressing numbers)
o	Voice matching (if user says 'buy products', it should know he meant 'shopping' 
o	Can spell things out like emails  j o h n d o e @gmail.com
•	Rye
o	Allows us to pass a markup to product price. It will charge card for the marked up price but only sends Amazon their price.
o	Allows checkout of multiple products and quantities
o	Includes free shipping from Amazon Prime
o	Can pass over description, full details and reviews of any given product
o	If an order is not eligible for free Prime shipping, it should pass over the shipping amount.
o	Can pass status of existing orders

Admin 
1.	User Management
a.	View/add/edit/freeze/delete users and their main data with filter and sort
b.	Can update a user’s password
c.	Can see login history of any user
d.	Can whitelist a user and then that user will be charged only the base product pricing without any markup.
2.	Order Management
a.	View all orders and the products included in them
b.	Can filter orders via user, date range, or contained product
3.	Settings
a.	Auto mark up default %
4.	Catalog Category Management
a.	Can add/edit/delete catalog categories
b.	Can have parent/child categories up to 3 levels deep
5.	Catalog Product Management
a.	Add/edit/delete products
b.	Set category (or multiple categories) 
c.	Set VoiceX ID for each item (Can also be auto generated)
d.	Set Amazon link/asin for each product for passing to RYE API
e.	Can override product name and description with custom. If empty it will use Amazon data.
f.	Can see lifetime purchase total for each product
g.	Product price auto generates using Amazon price plus the default markup % from Settings, but can overwrite to a custom price.
6.	Admin Reports
a.	View and export an excel download of all products purchased in any date range.
b.	Sort / filter list by date range and qty
7.	Functions
a.	Caller Number Detection
i.	Can detect if an account exists for that number and if active or frozen
b.	Registration
i.	User can pass over Name, Phone, Email, PW 
c.	Addresses
i.	User can save multiple addresses
ii.	Addresses can be added at registration or at checkout
iii.	For each address can enter: Address, Apt, Street, City, State, Zip
d.	Credit Cards
i.	User can save multiple credit cards
ii.	Cards can be entered  at registration or at checkout
iii.	For each have to enter: CC number, date, cvv
e.	Detect Product Availability on Amazon at time it is added to VoiceX cart, with a fallback if out of stock.
f.	Order Status
i.	Can check the status of an existing order 
Here is the IVR Flow

IVR should not be hard coded, rather we should have a management in admin to be able to easily edit the IVR flow so later we can easily add things and make changes….
In all places should either be able to enter option pressing the physical phone key, by saying that number, or by saying that option. So for example  if say either 'One' or say 'Catalog' or press the digit 1, then will go to catalog “ 

1. Call Initiation & User Identification
When a user calls the hotline, the system triggers the Check User API using the caller ID.
The API validates:
•	Whether the user exists
•	Whether the account is active or frozen
API Response Handling:
•	If account is frozen 
o	Play: “Your account is currently restricted. Please contact support.”
o	Call is terminated
•	If user exists →: ValidatePIN
•	If new user → : Register
________________________________________
2. PIN Validation Flow (Existing Users)
•	User enters 4-digit PIN (DTMF)
•	If pin is correct then it should right away redirect to Main Menu, no need for confirmation. Only if wrong it should ask customer to renter PIN
Flow:
•	1 → Main Menu
•	2 → Repeat PIN entry
________________________________________
3. User Registration Flow (New Users)
Step 1: Capture Name
•	User speaks name followed by #
•	System reads back ( Best if reads full name and then repeats it again letter by letter)
•	Confirmation:
o	Press 1 to confirm
o	Press 2 to reenter
________________________________________
Step 2: Set PIN
•	User enters PIN (DTMF)
•	System reads back 
•	Confirmation:
o	Press 1 to confirm
o	Press 2 to re-enter
________________________________________
4. Main Menu
Prompt:
 -   Say or Press: 1 for Catalog,-
-  2 for Cart
- 3 for Order Status
(So for example if say either 'One' or say 'Catalog' or press the digit 1, then will go to catalog “Say Catalog, Cart, or Orders)
Routing:
•	Catalog → Product flow
•	Cart → Cart flow
•	Order Status → Orders flow
•	Returns > this is a dummy static option, if selected it will just replay main menu again
________________________________________
5. Catalog Flow
Step 1: Catalog ID Input
•	User enters Catalog ID (DTMF)
•	it should right away do an API look up and read the product name from our server

Confirmation:
o	Press 1 or say Add to Cart
o	Press 2 or say More Details
o	Press 3 or say Get Reviews
o	Press 4 or say Another Product
o	Press * or say Back to Main Menu
•	Product Lookup API called (we already called the VoiceX API to get the product name. Can now call the RYE API to get details and reviews if requested)
If not found:
•	Retry Catalog ID input
________________________________________
Step 2: Add to Cart (Sequential Input)
•	User enters quantity (DTMF)
•	System reads back quantity
•	Confirmation:
o	Press 1 to confirm
o	Press 2 to re-enter
•	Stock API check
If available:
•	Add to cart
•	Read confirmation
o	Press 1 or say Add Another Product
o	Press 2 or say Checkout (will take them to cart)
o	* or say Main Menu
If not:
•	Inform user  (Lets say he enters 5 qty and there are only 3, will it give him a message that there are at least 3 available )
•	
________________________________________
6. Cart Flow
Step 1: Cart Summary
System reads:
•	Total items
•	Quantity
•	Amount
________________________________________
Step 2: Actions

1 - There should be an option to play back a list of all the items

2 - Also add option skip to checkout
3 - Change Item
•	Enter Catolog ID (DTMF)
•	Confirm (1 / 2)
•	Enter Quantity (DTMF)
•	Confirm (1 / 2)
•	Update API
________________________________________
4 - Remove Item
•	Enter Catalog ID (DTMF)
•	Confirm selection (1 / 2)
•	Confirm removal:
o	Press 1 to remove
o	Press 2 to cancel
________________________________________
7. Checkout Flow
________________________________________
Step 1: Address Entry – We need google address api to make sure all the address are legit and to give auto suggest
Each field is entered 
1.	Enter House/Street Number
2.	Enter Street Name and apt (numeric keypad mapping if needed)
3.	Enter City
4.	Enter State
5.	Enter ZIP Code
After all fields:
•	System reads full address
•	Final confirmation:
o	Press 1 to confirm
o	Press 2 to restart address entry
•	Address saved via API
•	If there is an address already in system for that user, it will ask him if he wants to use it or if he wants to enter in a new one.
________________________________________
Step 2: Payment Method (Sequential Input)
All card inputs are manual (DTMF only)
1.	Enter Card Number
o	Confirm (1 / 2)
2.	Enter Expiry Date
o	Confirm (1 / 2)
3.	Enter CVV
o	Confirm (1 / 2)
•	System reads masked card
•	Final confirmation:
o	Press 1 to confirm
o	Press 2 to re-enter
•	Tokenization API called
•	
________________________________________
Step 3: Order Summary
•	System computes total and delivery estimate
•	If there is any shipping charge, it should mention it here
Prompt:
 “Your total is [amount]. Estimated delivery is [date].”
________________________________________
Step 4: Confirmation
•	Press 1 → Place Order
•	Press 2 → Cancel
Flow:
•	Confirm → Order placed → Success message
•	Cancel → Return to Cart
________________________________________
8. Orders Flow
Step 1: Orders List
•	System reads recent orders
________________________________________
Step 2: Order Details
•	Enter Order ID (DTMF)
•	System reads back
•	Fetch and read details
________________________________________
9. Timeout and Input Handling
•	Each step has a default timeout 
If no input:
•	System reprompts
After repeated failures:
•	Call is terminated gracefully

