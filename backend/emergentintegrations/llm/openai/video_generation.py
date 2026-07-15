class OpenAIVideoGeneration:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    async def generate_video(self, *args, **kwargs):
        raise RuntimeError("emergentintegrations is not installed in this local environment")

