BS”D

## Summery

Goal of this task is to allow users to subscribe to certain products that will then be ordered for them automatically without any further initiation on their end.

A ‘Subscription’ user has up to 4 ‘Deliveries’ a month, one per ‘Week, and each Delivery contains a ‘Package’ of products. In order to ‘subscribe’ to a product, a user has to add it to at least 1 monthly ‘delivery’, but can add it to as many as all 4 ‘deliveries’.

## Terminology

- Subscription - The overall feature: products a user auto-orders on a recurring monthly basis, with no further action needed on their end.
- Week  - One of the 4 monthly time periods (Week 1–Week 4), each corresponding to a week of the month.
- Delivery - A recurring slot tied to a ‘Week’. Each user has up to 4 deliveries per month (one per Week). A product must be in at least 1 delivery to be subscribed, and can be in up to 4.
- Package - The collection of products (each with a quantity) inside a single ‘Delivery’. (Not to be confused with the main shopping cart.)

## Functionality

User can:

- Add a product to a ‘Delivery Package’ with a set quantity
- Can add same product to multiple  ‘Deliveries’  at the same time
- Can edit product quantity in a ‘Delivery Package’
- Delete a product from a ‘Delivery Package’
- Transfer a product to a different  ‘Delivery’
- Hear a list of what is currently found in a  ‘Delivery Package’
- Clear an entire  ‘Delivery Package’
- Pause all ‘Subscription Deliveries’
- Pause a single ‘Delivery’
- Set/change address that will be used for all  ‘Subscription Deliveries’
- Set/change credit card  that will be used for all  ‘Subscription Deliveries’

## IVR Flow

Note: In all places, pressing on * will take user back to the previous menu.

On Main Menu IVR Node, lets add an option for Subscriptions

It would now say "Main Menu! - To place an order, press 1.- To manage your cart, press 2. - For order status, press 3.  - For returns, press 4. - For subscriptions, press 5.

- If they click on 5 it will give the following Menu: [Subscription Node: 01] To add products, press 1. To hear the products in your Packages, press 2. To edit product quantity, press 3. To transfer products, press 4. To remove products, press 5. To pause or reactivate a Delivery, press 6. To set your Subscription Address, press 7. To set your Subscription Card press 8. For an explanation of how subscriptions work, press 9.( Note: Until a user listens 2 times to the explanation , the system will right away play it in the beginning: and it should start it with "Here is how subscriptions work, to skip and confirm you agree to the terms, Press #1." After the user has accessed the explanation 2 times, it will only be listed as option 9 at the end of the main subscription menu.)
  - If they click 9 ‘subscriptions explanation’ then it will bring up prompt: [Subscription Node: 02] Subscriptions allow you to automatically order products that you need on a constant basis. Once you set up your Deliver Packages, your orders will be shipped out to you consistently at your selected time slots, without you having to do anything on your end. We process up to four Deliveries each month. The First Delivery is processed on the 1st of each month. The Second Delivery is processed on the 8th of each month. The Third Delivery is processed on the 15th of each month. The Fourth Delivery is processed on the 22nd of each month. If while processing a Delivery we see that there is less quantity of the product available then what you have selected, we will send whatever quantity is possible. If the product is out of stock, we will still process the reminder of the products from the Delivery Package. Deliveries are processed at 12am EST on each processing date 1st, 8th, 15th, 22nd of the month. Any change made to the Delivery  such as pause, edit quantity, add or remove product, change address or card after midnight EST going into the processing date, get applied to the next cycle, not the one that will be processed the next morning. By confirming a Delivery, you authorize VoiceX to automatically place and charge subscription orders for the selected Delivery Packages according to its schedule. Prices and availability may change.Subscription orders use the current VoiceX selling price at processing time.
    - Right when this is done it will auto redirect back to  [Subscription Node: 01] ‘main subscription menu’
  - If they click 2 ‘hear delivery products’, it will give them: [Subscription Node: 03] To hear the Products in your First Week Delivery, press 1.  Second Week Delivery, press 2. Third Week Delivery, press 3. Fourth Week Delivery, press 4. To return to the main subscription menu, press star.
    - If click on 1-4, it will give them  [Subscription Node: 04] Your {First} Week Delivery, contains the following products in its Package: and will then read them a full list of all the product in the delivery. For each it will say product name and the qty.
      - If that delivery package is empty it will give:  [Subscription Node: 05] Your {First} Week Delivery Package currently contains no products. To add a product Press 1. To hear your other Delivery Packages Press 2. To return to the main subscription menu press 3.
        - If click 1 ‘add product to this package’ it will go to [Subscription Node: 06]  Please enter the catalog number for the product you would like to look up, followed by Pound. (They can then enter in the VoiceX catalog ID number)
          - If product is found in catalog: it gives [Subscription Node: 07] You have selected {Product Name} Press 1 to Add it to this Package. Press 2 for More Details. Press 3 for Reviews. Press 4 for Another Product.
            - If press 1 ‘add to package’ then it gives [Subscription Node: 08] How many would you like to add? Enter the quantity and then press pound. It will then right away give [Subscription Node: 09] Press 1 to confirm, or press 2 to re-enter.
              - If press 1 ‘confirm’ it gives [Subscription Node: 41] {Product name} has been added to your {First} Week Delivery Package. Press 1 to add another product. Press 2 to go back to main Subscription Menu. Press 3 to add this same product to another Delivery Package. (option #3 should only be there, if there is at least 1 Delivery Package, that does not yet contain this product.)
                - If press 1 ‘add another product’ then it goes back to [Subscription Node: 06]
                - If press 2 ‘subscription menu’ it goes back to  [Subscription Node: 01]
                - If press 3 ‘add same to other package’ then it gives [Subscription Node: 10] (it will then give the remaining Delivery packages where this product is not found yet) Press 1 to add {Product Name} to your {Second} Week Delivery Package. Press 2 to add it to your {Third} Week Delivery Package. Press 3 to add it to your {Fourth} Week Delivery Package. Once select an option, it gives [Subscription Node: 08]
              - If press  2  ‘re-enter’ then it goes back to [Subscription Node: 08]
            - If press 2 ‘more details’ then it gives all the details just like in [more_details Node]. It then goes back to  [Subscription Node: 07]
            - If press 3 ‘reviews’ then it gives reviews just like in [reviews Node] It then goes back to [Subscription Node: 07]
            - If press 4 ‘another product’ then it goes back to [Subscription Node: 06
          - If product was not found then it gives [Subscription Node: 11] ‘Product with catalog number {456778} was not found. Please enter a different catalog number.’ (And can then enter the product again.)
        - If click 2 ‘hear other package’ it will take them to [Subscription Node: 03]  ‘select Week to hear package’]
        - If click on 3 it will go back to [Subscription Node: 01]
      - After it is finished reading the list it will right away go ahead and say menu:  [Subscription Node: 12]  To hear your other Delivery Packages, press 1.  To add products to this Delivery Package, press 2, To edit product quantity in this Delivery Package, press 3. To transfer products from this Delivery Package to another Delivery Package, press 4. To remove products from this Delivery Package, press 5. To pause this Delivery, press 6. (If the package is already paused then instead it will say, To Reactivate this Delivery press 6)
        - If click 1 ‘hear other package’ it will take them to [Subscription Node: 03]  ‘select Week to hear package’]
        - If click 2 ‘add product to this package’ it will take them to [Subscription Node: 06] ‘add products to selected package’
        - If click 3 ‘edit products in package’ it will give [Subscription Node: 13] If you know your product’s VoiceX ID, press 1. To hear a list of all products in this Package press 2.
          - If click 1 ‘know ID’ it gives [Subscription Node: 14] Please enter the catalog number for the product you would like to change its quantity, followed by Pound.
            - If product is found in package: it gives [Subscription Node: 15] You have selected {Product Name} with quantity {5}. Enter your new quantity, and then press pound. It will then right away give [Subscription Node: 16] Press 1 to confirm, or press 2 to re-enter.
              - If press 1 ‘confirm’ it gives [Subscription Node: 17] The quantity for {Product name} has been updated to {3}. Press 1 to change the quantity of another product. Press 2 to go back to main Subscription Menu.
                - If press 1 ‘change other qty’ then it goes back to [Subscription Node: 13]
                - If press 2 ‘subscription menu’ it goes back to  [Subscription Node: 01]
              - If press  2  ‘re-enter’ then then it goes back to [Subscription Node: 14]
            - If product was not found in package then it gives [Subscription Node: 11] ‘Product with catalog number {456778} was not found. Please enter a different catalog number.’ (And can then enter the product again.)
          - If click 2 ‘hear list’  it will give them  [Subscription Node: 18] It will then read them a full list of all the products in the Delivery. For each it will say product name and the qty and say “to edit this product press 1, followed by pound.”, “to edit this product press 2, followed by pound.” “to edit this product press 11, followed by pound.” etc…
            - After user selects a product from list it should then give [Subscription Node: 15]
        - If click 4 ‘transfer products in package’ it will give [Subscription Node: 19] If you know your product’s VoiceX ID, press 1. To hear a list of all products in this Package press 2.
          - If click 1 ‘know ID’ it gives [Subscription Node: 20] Please enter the catalog number for the product you would like to transfer, followed by Pound.
            - If product is found in that Delivery Package: it gives [Subscription Node: 21] You have selected {Product Name} with quantity {5}. Select which Weekly Delivery Package you would like to transfer it to. (It will then list the remaining 3 delivery packages, but only if they do not already have that product in it. If one of the Packages already has that product in it, then it will skip that package and not give it as an option.) Press 1 to transfer {Product Name} to your {Second} Week Delivery Package. Press 2 to transfer it to your {Third} Week Delivery Package. Press 3 to transfer it to your {Fourth} Week Delivery Package.
              - Once select an option, it adds that product to that package and removes it from its previous package, it then gives [Subscription Node: 22] {Product Name] with a Qty of {3} has been transferred to to your {Second} Week Delivery Package. Press 1 to transfer another product. Press 2 to return to the main subscription menu.
                - If press 1 ‘transfer another product’ it takes you back to [Subscription Node: 19]
                - If press 2 'subscription main menu’ it goes back to [Subscription Node: 01]
            - If product was not found then it gives [Subscription Node: 23] ‘Product with catalog number {456778} was not found in this Delivery Package. Please enter a different catalog number.’ (And can then enter the product again.)
          - If click 2 ‘hear list’  it will give them  [Subscription Node: 24] It will then read them a full list of all the products in the Delivery. For each it will say product name and the qty and say “to transfer this product press 1, followed by pound.”, “to transfer this product press 2, followed by pound.” “to transfer this product press 11, followed by pound.” etc…
            - After user selects a product from list it should then give  [Subscription Node: 21]
        - If click 5 ‘remove product’ it will give [Subscription Node: 44]. To remove all products in the package, press 1. To remove only a specific product, press 2.
          - If click 1 ‘remove all’, it will give  [Subscription Node: 45] Press 1 to confirm that you would like to remove all products from this Delivery Package, and completely empty it. This delete action is non reversible. Press 2 to cancel and go back.
            - If press 1 ‘confirm delete’ it gives: [Subscription Node: 46] All the products from the {First} Week Delivery Package have now been removed and your Package is currently empty. To add a new product, press 1. To go back to main subscription menu, press 2
              - If click 1 ‘add product’ then it goes to [Subscription Node: 06]
              - If click 2’ ‘main subscription menu’, then it goes to  [Subscription Node: 01]
            - If press 2 ‘cancel’ then it goes back to [Subscription Node: 44]
          - If click 2 ‘remove specific’ then it gives [Subscription Node: 47]  If you know your product’s VoiceX ID, press 1. To hear a list of all products in this Package press 2.
            - If click 1 ‘know ID’ it gives [Subscription Node: 48]  Please enter the catalog number for the product you would like to remove, followed by Pound.
              - If product is found in package: it gives [Subscription Node: 49] You have selected {Product Name} with quantity {5}. Press 1 to confirm removal, or press 2 to re-enter.
                - If press 1 ‘confirm’ it gives [Subscription Node: 50] {Product name} was removed. Press 1 to remove another product. Press 2 to go back to main Subscription Menu.
                - If press 1 ‘remove another’ then it goes back to [Subscription Node: 47]
                - If press 2 ‘subscription menu’ it goes back to  [Subscription Node: 01]
                - If press  2  ‘re-enter’ then then it goes back to [Subscription Node: 48]
              - If product was not found in package then it gives [Subscription Node: 51] ‘Product with catalog number {456778} was not found. Please enter a different catalog number.’ (And can then enter the product again.)
            - If click 2 ‘hear list’  it will give them [Subscription Node: 52] It will then read them a full list of all the products in the Delivery. For each it will say product name and the qty and say “to remove this product press 1, followed by pound.”, “to remove this product press 2, followed by pound.” “to remove this product press 11, followed by pound.” etc…
              - After user selects a product from list it should then give [Subscription Node: 49]
        - If click 6 ‘pause Delivery’ it will give  [Subscription Node: 25]. Press 1 to pause your {First} Week Delivery for the upcoming Monthly cycle. Press 2 to pause it for the next 3 upcoming Monthly cycles. Press 3 to permanently pause it.
          - It will then give  [Subscription Node: 26] Your {First} Week Delivery has been paused for {paused cycles}. It will then take them back right away to man subscription menu [Subscription Node: 01]
        - If click  6 ‘Reactivate package’ (in case where it was paused) it will give  [Subscription Node: 27] Press 1 to confirm that you would like to reactivate your {First} Week Delivery.
          - It will then give [Subscription Node: 42] Your {First} Week Delivery has been reactivated. It will then take them back right away to man subscription menu [Subscription Node: 01]
  - If they click 1 ‘add  products’, it will give them [Subscription Node: 28]  To add Products to your First Week Delivery, press 1.  Second Week Delivery, press 2. Third Week Delivery, press 3. Fourth Week Delivery, press 4. To return to the main subscription menu, press star.
    - If click on 1-4, it will give them  [Subscription Node: 06]
  - If they click 3 ‘edit product qty’,  it will give them [Subscription Node: 29]  To edit Products in your First Week Delivery, press 1.  Second Week Delivery, press 2. Third Week Delivery, press 3. Fourth Week Delivery, press 4. To return to the main subscription menu, press star.
    - If click on 1-4, it will give them  [Subscription Node: 13]
  - If they click 4 ‘transfer products’,it will give them [Subscription Node: 30]  To transfer  Products from your First Week Delivery, press 1.  Second Week Delivery, press 2. Third Week Delivery, press 3. Fourth Week Delivery, press 4. To return to the main subscription menu, press star.
    - If click on 1-4, it will give them  [Subscription Node: 19]
  - If they click 5 ‘remove product’ it will give them [Subscription Node: 53]  To delete Products in your First Week Delivery, press 1.  Second Week Delivery, press 2. Third Week Delivery, press 3. Fourth Week Delivery, press 4. To return to the main subscription menu, press star.
    - If click on 1-4, it will give them  [Subscription Node: 44]
  - If they click 6 ‘pause or reactivate delivery’, it will give them: [Subscription Node: 31]  To pause your First Week Delivery, press 1.  Second Week Delivery, press 2. Third Week Delivery, press 3. Fourth Week Delivery, press 4. To pause all your Deliveries press 5. To return to the main subscription menu, press star. (If one of them was paused already it will add that one like ‘Your Second Week Delivery is already paused, to reactivate it press 2)(if all 4 were paused it should also give an option re reactivate them all at once)
    - If click on 1-4, it will give them  [Subscription Node: 25]
    - If click 5 it will give  [Subscription Node: 32]  Press 1 to pause all 4 deliveries for the upcoming Monthly cycle. Press 2 to pause them for the next 3 upcoming Monthly cycles. Press 3 to permanently pause them.
      - It will then give  [Subscription Node: 33] All 4 of your Deliveries have been paused for {paused cycles}. It will then take them back right away to man subscription menu [Subscription Node: 01]
    - If Delivery was paused and click to reactivate it, it will give  [Subscription Node: 27]
  - If they click 7 ‘set address’, it will give them: [Subscription Node: 34] Your current address is {read default address}, to use this address Press 1, to use another one of your saved addresses press 2, to enter in a new address press 3 (If no saved address on account it will just give: You currently do not have any saved addresses, Press 1 to enter an address)
    - If press 1 ‘use current’ it will give [Subscription Node: 43] {read address} will now be used for all your Deliveries. It will then right away go back to main subscriptions menu [Subscription Node: 01]
    - If press 2 ‘use another address’ it will give them [Subscription Node: 35] a list of all their addresses and they can select one and then it will give them [Subscription Node: 43]
    - If press 3 ‘use new address’ it will give them [Subscription Node: 36] enter new address just like in cart and when done will give them [Subscription Node: 43]
  - If they click 8 ‘set card’, it will give them: [Subscription Node: 37] Your current credit card is {read last 4 digits of their default card}, to use this credit card Press 1, to use another one of your saved cards press 2, to enter in a new credit card press 3. (If no saved card on account it will just give: You currently do not have any saved card, Press 1 to enter a card)
    - If press 1 ‘use current’ it will give [Subscription Node: 38] {read last 4 digits of their card} will now be used to pay for all your Deliveries. It will then right away go back to main subscriptions menu [Subscription Node: 01]
    - If press 2 ‘use another card’ it will give them  [Subscription Node: 39] a list of all their saved cards and they can select one and then it will give them [Subscription Node: 38]
    - If press 3 ‘use new address’ it will give them [Subscription Node: 40] enter new credit card just like in cart and when done will give them [Subscription Node: 38]

## IVR Flow Logic

- Processing Cutoff Time
  - Deliveries are processed at 1200am EST on each processing date (1st, 8th, 15th, 22nd).
  - Any change a user makes (pause, edit quantity, add/remove product, change address or card after midnight EST going into a processing date applies to the NEXT cycle, not the one processing that morning.
  - Way it should work is that at exactly 12:00 AM EST, the system locks a processing snapshot for that Delivery. Any edits after that time apply only to the next monthly cycle, even if that customer’s order is processed later in the batch.

## Alerts Functionality

- If the system detects that a user has a pending alert, then next time he calls in  before the Main Menu, it will notify him that he has a pending alert and give him the option to hear it.
  - Right after entering in PIN and before Main Menu it will give user the following prompt: You have 2 alerts. To listen to the alerts, press 1. Otherwise, press 2 to continue.
    - If press 1 ‘listen to alerts’: the system reads each alert one at a time. E.g. “Your credit card ending in 4242 was declined while processing your First Week Delivery on June 8th. Please update your Subscription Card.
      - If the alert includes a ‘call to action’, then after the alert, instead of auto moving to the next alert, it should give a prompt with the ‘Call to Action:  Press 1 to update your Subscription Card now. Press 2 to hear the next Alert. (if there are no more alerts it will not give this 2nd option)
        - If press 1, it will jump him to the location in the IVR flow where the action can be done.
          - If he resolves card it will give him: Press 1. to retry your failed Delivery now. Press 2 to skip this delivery.
            - If press 1 it will try charging the card again and if goes through, it will give him a success confirmation message. Delivery will get marked as Processed and alert gets marked as Resolved. Order is created.(If retry failed again then all statuses remain the same and user gets failed message)
            - If press 2, it goes back to Main Menu and item gets marked as ‘Skipped’
        - If press 2, it moves to next alert
      - Once an alert has been heard in full, it is marked with tag ‘heard’ and does not replay again for that user.
    - If press 2 ‘skip’ then it jumps to Main Menu. Alerts remain as tag ‘Unheard’ and will play again on the next call until they are heard or resolved.

## Admin

- On Order Management https://www.voicexshop.com/admin/orders
  - Add new column ‘Type’: Cart, Week 1, Week 2, Week 3, Week 4
  - Add new ‘Type Filter’ where can filter one or more of the above Types
- On Dashboard https://www.voicexshop.com/admin add cards for:
  - Subscribing Users = total users that have an subscription with at least one Active Delivery
  - Deliveries = total active deliveries in system. So if a single user has 4, then total will be boosted by 4.
- Subscriptions Management
  - Create new subscription management page
  - Link it from sidebar after Orders link
  - It should have card style rows, so data can be nicely stacked
  - Each row should show:
    - Customer name
    - Phone number
    - Total Products - from all 4 packages
    - Total Cost - from all 4 packages
    - Week 1 Mini Card
    - Week 2 Mini Card
    - Week 3 Mini Card
    - Week 4 Mini Card
      - If a Delivery is empty then it should just show a gray placeholder, and have an edit icon
      - Each Mini Card will have the following data
        - Products = total products found in that package
        - Cost = total cost of all products in that package
        - Edit Icon = Brings up the edit/view popup
        - History Icon  = Brings up popup with the order history of that Weekly Delivery for that User. By each entry it should also show the Order ID, If click on order ID it should open up that order. It will also show a time stamped log entry for each edit made to the Package, such as add/remove product and update qty. And if it was done by Admin User (and which one). Or by customer on Hotline.
        - Status - With following statuses: Active, Temporarily Paused, Permanently Paused, Failed (failed is Active but failed to process payment)
          - If active, it will show next cycle date and ‘Pause Button’
          - If Temporarily Paused  paused it should show, what kind os pause it was, the resume date. And ‘Activate Button’
          - If Permanently Paused it will show date when it was paused And ‘Activate Button’
          - If failed it will show failed date
        - If click on Pause button, then can set ‘Permanent Pause’ or select the amount of cycles it should be paused for.
        - If click on Activate then it becomes active right away (if want a delayed activation then can just do a temporary pause again)
    - Each row should also have a checkout icon. If click on it then it brings up small view popup that shows: subscription address, card last-4
    - In checkout popup can click on edit to select other saved address of that user or add a new one (just like can do on view user)
    - Can also edit credit card to select other saved card from user or add a new one (just like can do on view user)
    - Will have history icon with  a time stamped log entry for each card or address change And if it was done by Admin User (and which one). Or by customer on Hotline.
    - If a subscription has any alerts related to it, either “Delivery Issue’ alerts or ‘Failed Delivery Alerts' then it should have red circle with count of alerts that are not yet status resolved. If click  count, it should bring up a popup with the list of the alerts. In the popup admin should have the ability to edit the alert status with inline status popup editor.
  - Page will have search: by name, phone number
  - On top of page it will have a status filter. So for example if select ‘failed’ it will show rows where it has at least one Delivery currently in status ‘Failed’
  - If click the Edit icon on a Delivery, then it brings up a popup that contains all the products currently found in the Delivery Package
    - Can sort by product name, price, qty
    - Can edit product qty (important that admin can do manual edits when needed)
    - Can transfer product - if click on transfer icon then it bring up popup with the remaining 3 packages and can select one and it will get transferred there.
    - Can add new product, there will be search box where can enter product name or ID and will show list of matching product, can then click on add button and select a qty and product gets added to the package.
    - Each product row will have: Thumb, Product Name, VoiceX ID, ASIN, quantity, current Amazon price, Price,  line total
    - Will again show cart total cost
    - Will also show status and Pause/Activate button (see above)
- Subscription Queue
  - Delivery subscriptions will be processed at  at 12AM on the date of the delivery:1st, 8th, 15th, 22nd
  - Will show a list of all the Subscription transactions
  - It will show all the upcoming Subscriptions of the next Week Delivery as pending.
    - As soon as the 1st Week delivery was processed. It should add all the upcoming 2nd week Deliveries as ‘pending’ to the queue. As soon as the 2nd Week delivery was processed. It should add all the upcoming 3rd week Deliveries as ‘pending’ to the queue. Etc…
  - Will have status filter on top of page: Pending, Issue, Processed, Partial, Failed, Skipped
  - All rows will show Customer Name, Phone, Email, Total products, total cost  and icon to bring up the full details in a popup like show on rows in Subscriptions Management
  - If status is pending it will show time date of estimated processing
  - If status is “processed’ it will show: Transaction time and date,  VoiceX order ID (that is linked to actual order). Amazon Order ID (if there were multiple ones, it should show all), Sola Transaction ID
  - ‘Partial’ means that some of the products in the package were either unavailable or quantity reduced at the time of the order, and that order was placed without them. It should have all the details found on status ’Processed’ and will also have an icon if click on it, will show a list of all the items that were left out and what the reason was. If qty was changed it will show what original qty was and what it was actually sent out in the end.
  - On failed status. It will give transaction attempt time. It will also give error icon ( If click it will show payload from the transaction showing the error details). It will have history icon, with all the transaction attempts with time stamp. It will also have two buttons: Retry, Skip
  - If click on ‘Retry’ it will retry the transaction again
  - If click on Skip’ it will skip that Delivery and next round continue with it as normal. It will change status to ‘Skiped’
  - All retry and skip attempts get logged in the history feed of that subscription Delivery.
  - 24 hours before processing time, system should do a pre run check on all pending Deliveries
    - It will check the card on each Delivery to see if date expired already
    - If there is way to ping Sola safely and check if card is still valid we can do
    - It should also ping Amazon api to see if all the products and their qty are still available
    - If any issues are detected it should change the status of that Subscription delivery to ‘Issue’ and on row give details of what the issue is
    - If a delivery is status ‘Issue’ and it was resolved before processing time it should change back to ‘Pending’
    - If a delivery is status ‘Issue’ and it was not resolved before the real processing time, then:
      - If it was expired or invalid card, or if all products were unavailable, or it has an invalid address, then it should not try to process it and it should just change status to ‘failed’ and error details mark that it was status issue and process was not even attempted. And it should also retain the info of what made it ‘issue’ to begin with.
      - If only partial products or qty were unavailable then it should try changing it and submitting the partial order.
- On https://www.voicexshop.com/admin/users
  - It will have column ‘Subscription’ that will show value 0 or 1-4
  - If click on the number 1-4 then it brings up popup that shows all the elements found in that user’s row on ‘Subscriptions Management’ or can link to that row on that page
  - Also on view user https://www.voicexshop.com/admin/users/1b7029bc-2623-43ed-978d-00f59d65ea54 it will have Subscription box that will show value 0 or 1-4 and if click will bring up same
- On https://www.voicexshop.com/admin/products
  - In view product popup should have a new section called ‘Subscriptions’
    - Quantity = total quantity of this product across all currently active deliveries
    - Deliveries = Amount of  currently active weekly deliveries that contain at least 1 qty of this product in time range
    - Subscribers = Amount of users who have product in at least one currently active Delivery
- On https://www.voicexshop.com/admin/reports
  - Add a new Report: Monthly Subscription Revenue
    - Has date range selector
    - Shows a list of all Processed and Partial Deliveries in that date range
    - For each should show: Status, Order ID, Week {2}, Customer Name, Number, Phone, Total Products, Order Total, Amazon Total, Profit (order total minus amazon total)
    - On top it should have highlighted row showing the grandtotals for all deliveries during the time range: total products, order costs, amazon costs, profits
  - Add a new Report: Paused Subscriptions
    - Has date range selector
    - Shows a list of all Temporarily Paused and Permanently Paused Deliveries in that date range
    - For each should show: Status, Week {2}, Customer Name, Number, Phone, Total Products, Order Total
    - On top it should have highlighted row showing the grandtotals for all deliveries during the time range: total products, order totals
  - Add a new Report: Failed Subscriptions
    - Has date range selector
    - Shows a list of all Failed  Deliveries in that date range
    - For each should show: Week {2}, Customer Name, Number, Phone, Total Products, Order Total
    - On top it should have highlighted row showing the grandtotals for all deliveries during the time range: total products, order totals and the ‘Failure Rate - percentage of Deliveries that failed in this time range vs the Deliveries that went through Processed and Partial
  - Add a new Report: Most-Subscribed Products
    - Has date range selector
    - Shows a list of all products that were included in successful subscription Deliveries during this time range.
    - For each will show:
      - Thumb
      - Product Name
      - VoiceX ID
      - Asin
      - Quantity = total quantity of this product across all deliveries in time range
      - Deliveries = Amount of weekly deliveries that contained at least 1 qty of this product in time range
      - Subscribers = Amount of users who had product in at least one Delivery during time range.
      - If click on the Subscriber amount, it should bring up a popup that lists all the subscribers how are subscribed to the product and in which deliveries they have them in and what qty:  Ex: Bob Jones - Week 1 x3, Week  3 x1
- On https://www.voicexshop.com/admin/alerts
  - Lets create a new alert tab: Delivery Issues
    - 24 hours before each delivery we are doing a pre run check on all pending Deliveries, any deliveries that have an issue, create a ‘Delivery Issue’ alert
    - For each alert it will have
      - Customer name, phone, email, week #,  date created,
      - It will also include the details of issue if it was:Expired Card, Products Unavailable, QTY Unavailable
      - Status: New, Reviewing, Resolved
  - Lets create a new alert tab: Failed Deliveries
    - Each time a Delivery fails it should create an alert
    - For each alert it will have
      - Customer name, phone, email, week #,  date created,
      - It will also include the ‘Type’ of issue if it was:Declined Card, Products Unavailable, QTY Unavailable, Incorrect Address, etc…
      - It will show if it is UnHeard or Heard
    - These Alerts also get listed in IVR Alert inbox of user, so when he calls in he will be told if he has any pending alerts and he can listen to them
    - Once a user heard an alert on the hotline it gets tagged as ‘Heard’
      - This should be a ‘tag’ not a ‘status’. Since status is an Admin indicator and ‘tag’ is a user flag
      - One an alert is tagged as “Heard’ it will no longer be declared in IVR user alert inbox
      - If a user revolves an alert on his own, like fixing a card or address, then status should change to ‘Resolved, just as if Admin had resolved it.
    - Page should have a User filter and a ‘Type’ filter, Status filter, Heard/Unheard filter, Date Range Filter
  - On top of  https://www.voicexshop.com/admin/alerts lets add an add button
    - When click it brings up a popup where admin can add a Manual alert
    - Also on Subscriptions Management in the alert popup of each row there will be an add button, where admin can add an alert. If added from there, by default it will select the user of that row.
    - First have to select what kind of alert it will be auto get assigned to that user and no need to have the select user dropdown
    - For now lets only do manual alerts for Failed Deliveries (later we will add for all types)
    - Have to select a user from searchable dropdown
    - Have text box where can add an admin note
    - Have text box where can add IVR message
    - Alert then gets added to the ‘Failed Deliveries Alert’ tab like all other alerts
    - Next time user calls into hotline he will be notified about this alert and if he selects to hear it, it will read him the ‘ IVR message’ of that alert

## Backend

- A Delivery can only be processable if it is active, has at least one product, a Subscription Address, and a Subscription Card.
- Processing of each subscription Delivery runs at 12AM on the date of the delivery:1st, 8th, 15th, 22nd
- Since processing all the subscription orders all at the same time, exactly at 12AM will be drain on the server and might even cause spam issues, and can cause the system to reach Amazon API limits, we can just start at 12AM and parse the order list adding time spacing, between each order even if it takes a few minutes or longer to send them all out.
- Every Delivery processing attempt must use an idempotency key based on user ID, delivery week, cycle date, and attempt number, in order to prevent accidental duplicate orders.
- Only products that are enabled can be added to subscriptions
- If a product becomes disabled after being added to a Delivery Package, it remains visible in the package but is skipped during processing, and a Delivery Issue alert is created.
- Unavailable products remain in package for future cycles unless removed
