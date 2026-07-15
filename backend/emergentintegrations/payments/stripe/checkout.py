class StripeCheckout:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    async def create_checkout_session(self, *args, **kwargs):
        raise RuntimeError("emergentintegrations is not installed in this local environment")

    async def get_checkout_status(self, *args, **kwargs):
        raise RuntimeError("emergentintegrations is not installed in this local environment")
