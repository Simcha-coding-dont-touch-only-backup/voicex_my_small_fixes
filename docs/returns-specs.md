Goal of this task is to deal with Returns here is basic idea how it will work, Create a plan and if you have any ideas to make it better ask so we can review your ideas....

On Main Menu IVR Node, lets add an option for Returns

It would now say "Main Menu! - To place an order, press 1.- To manage your cart, press 2. - For order status, press 3.  - For returns, press 4.

If they click on 4 it will give the following Menu

If you know your Voice X order number, Press 1. - To hear a list of your recent orders, press 2.

If they click 1 then it wil bring up prompt
Please enter your 5 digit Voice X order number
(Num digits should be set to 5, so as soon as finish entering in the order number it should go to next menu, without having to press #, same way like we are doing when entering in pin at start of call.)

It will then give a confirmation
You have entered Order {10022} that contained {5} products and with a total cost of {$44.55}

It should not ask for a confirmation and right after that it will give one of the following 3 menus

If order had only a single product in it with a qty of 1:
Your order only had a single product in it, {product name}, press 1 to confrim that you would like to return the entire order.

If order only had a single product it with a qty of more then 1:
Your order contained 1 product, {product name} with a qty of {5}. To retrun all {5} press 1, - To return partial qty, press 2.

If order had multiple prodcuts in it
To return the entire order, press 1. - To return individual products from the order, press 2. - To return a diffrent order, press 3 
(3rd option takes you back to 'Please enter your 5 digit Voice X order number')

If they selected 'To return the entire order, press 1.'
It will give a prompt 
'Press 1 to confrim that you would like to return the entire order.'


Also we need you to update the IVR management with all the new menus, steps and prompts.