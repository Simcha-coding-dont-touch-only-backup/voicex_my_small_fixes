# VoiceX Returns

BS”D

Goal of this task is to deal with Returns here is basic idea how it will work,

Note: In all places, pressing on * will take user back to the previous menu.

## Main Menu IVR Node

On Main Menu IVR Node, lets add an option for Returns

- It would now say "Main Menu! - To place an order, press 1.- To manage your cart, press 2. - For order status, press 3. - For returns, press 4.
  - If they click on 4 it will give the following Menu: [Return Node: 01] If you know your Voice X order number, Press 1. - To hear a list of your recent orders, press 2.
    - If they click 1 ‘If you know your Voice X order number’ then it will bring up prompt: [Return Node: 02] Please enter your 5 digit Voice X order number (Num digits should be set to 5, so as soon as finish entering in the order number it should go to next menu, without having to press #, same way like we are doing when entering in pin at start of call.) > It will then give a confirmation: [Return Node: 03] You have entered Order {10022} that contained {5} products and with a total cost of {$44.55}. It should not ask for a confirmation and right after that it will give one of the following 3 menus…

      (if an invalid order number was entered then it will give [Return Node: 15] You have entered an invalid order ID. It will then right away take them back to [Return Node: 02] ‘enter in order ID’)

      (Also it should check if the order was made within the last 30 days, if it was before 30 days, then it is not returnable and should give: [Return Node: 16] Sorry that order is too old and is no longer returnable. And should then go back right away to [Return Node: 02] ‘enter in order ID’)

      - If the order had only a single product in it with a qty of 1: [Return Node: 04] Your order only had a single product in it, {product name}, press 1 to confirm that you would like to return the entire order. Once they confirm and press 1, it will give a message: [Return Node: 05] Your order will be processed for return. The money will be refunded to your card once we confirm the items have been returned to Amazon. (It will then get added to the admin ‘Return Management’)
      - If order only had a single product in it with a qty of more than 1: [Return Node: 06] Your order contained 1 product, {product name} with a qty of {5}. To return all {5} press 1, - To return partial quantity, press 2.
        - If press 1 ‘return all {5}’ then it will give: [Return Node: 05] the order return confirmation
        - If press 2 ‘return partial qty’ it will give: [Return Node: 07] Enter the quantity you would like to return.
          - Once entered it will give a confirmation request: [Return Node: 18] Please press 1 to confirm that you would like to return {3} out of {5} from the {product name} quantity of your order.
            - When click 1, confirmation, then it gives: [Return Node: 05] the order return confirmation
      - If order had multiple product in it: [Return Node: 08] To return your entire order, press 1. To return a one or more specific products or partial qty of any product, press 2.
        - If press 1 ‘return your entire order’, then it will give: [Return Node: 05] the order return confirmation
        - If press 2 ‘return part of order’ it will give: [Return Node: 09] If you know the VoiceX ID’s of the products you would like to return, press 1. To hear a list of of all the products that were included in the order press 2.
          - If press 1 ‘know VoiceX ID’ then it will give: [Return Node: 10] Enter the VoiceX ID of the first product you would like to return and then press #.
            - If that product has a single qty then it will give: [Return Node: 11] Press 1 to confirm that you would like to return return {product name}.
              - When click 1, confirmation, then it gives: [Return Node: 12] Confirmed, this product will be processed for return. To return another product, press 1. To finalize your return, press 2.
                - If press 1, then it gives: [Return Node: 10] enter voicex ID
                - If press 2, then it gives [Return Node: 05] the order return confirmation
            - If that product has multiple qty it will give: [Return Node: 13] Product {product name} contained a quantity of {5}. To return all {5} press 1, - To return partial quantity, press 2.
              - If press 1 ‘return all {5}’ then it will give: [Return Node: 12] the product return confirmation
              - If press 2 ‘return partial qty’ it will give: [Return Node: 07]
                - Then when confirm it will give [Return Node: 12] the product return confirmation
          - If press 2 ‘hear a list of of all the products that were included in the order’ Then it will give: [Return Node: 14] It will list all the items in the order just like we do when listing the items in a cart. Each item it will tag with a number ex 1 or 11 (here have to press # since number can be 1 or 2 digits, there should also be a very short timeout lets try 3 seconds so even if user does not press # it should register right away. If user did not press anything and it times out, then it should just start and repeat the menu again) and will say: Here is a list of the products in your order, to return a product, press its number followed by #. To return {Product name 1}, press 1. To return {Product name 2}, press 2. To return {Product name 11}, press 11. Etc…
            - Once a number was pressed it will proceed as if that VoiceX ID had been entered and will give [Return Node: 11] if product had a single qty, or [Return Node: 13] if product had multiple qty
    - If they click 2 ‘‘To hear a list of your recent orders’, then it will read them a list of their recent orders from the last 30 days, and allow them to select one: Ex: To select order {order 1 ID} which contained {3} product with a total price of {$34.50}, press 1. To select order {order 2 ID} which contained {6} product with a total price of {$54.50}, press 2. Etc…

      (if there are no orders for that user from withing the last 30 days, it should give [Return Node: 17] Sorry you have no orders that were made within the past 30 days. And since they have no need for returns, it should right away return them back to the Main Menu.)

      - It will then work as if they had entered in an order ID on their own and will give:
        - If the order had only a single product in it with a qty of 1: [Return Node: 04]
        - If order only had a single product in it with a qty of more than 1: [Return Node: 06]
        - If order had multiple product in it: [Return Node: 08]

## Admin Return Management

- Each return should get an ID for reference
- Will give list of all order returns
- Time stamp when the return was initiated
- What was included in the return
- Calculation of $ of what is being returned vs what remains unreturned.
- Link to original order
- All details of customer
- Return status with ability to change it
- On order, it will then link to the return
- Once a return was marked as ‘Complete’ status, then it will readjust site profit stats
- On Admin sidebar lets add new link ‘Returns’
- It should have circle with total count of all returns that are currently in status ‘Pending’.
  (similar to how we did with alerts link count)

## IVR Management

Also we need you to update the IVR management with all the new menus, steps and prompts.

## Return Labels

We still need a way to handle the actual return label by mail, fax, or email. We will wait to hear back from Amazon and then we will be able to map it out.

## User Accounts

- On https://www.voicexshop.com/admin/users lets add a column, ‘Returns’ that will include the all time total amount of orders returned by that user,
- It should have sort arrows so can easily sort to see the users with the most returns
- If a user made more then 3 returns the background of his row should be light orange
  If he made more then 5 returns the background of his row should be light red
- The amount of returns, should be clickable.
- If click it brings up a popup with a history of all this returns
- Each row should have: Order ID, Order Date, Return ID Return Date, List of products returned in that order and the qty for each that was returned and the value returned for product and the total return value
- Also once if user did more then 5 returns, it should create an Alert for him in alert section, we should have an new type of alert called ‘High Returning User’ alert

## Reports

- Lets add in a new Report type called ‘Returned Items’
  - By default it should show all time data but on top of page it will have date range filters where can select to see the return data from a specific date range.
  - For each row it will show product name and the amount of times it was returned
  - Will also have a column for total returned qty. So lets say product had qty of 5 and was returned on one order, then in first column it will show just 1 but in second column it will show 5.
  - In action column there will be a history icon
  - If click on history, it will bring up a popup of return history for that item, it will show an entry for each return, including; Order ID, Order date, Return ID, return date, qty returned, total return value (ex 3 x $22.34 so would show $67.02), Customer name
  - Each column should have sort arrows, so can easily sort the number columns to see the products with the most returns within a specific date range.

## Stage #2

- Once we have the AI feature, it should be available to say which items they want to return when they want to return one or a few items from a big order, in addition to having the option to enter the Voicex ID.
