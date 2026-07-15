class _Content:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class UserMessage(_Content):
    pass


class FileContent(_Content):
    pass


class ImageContent(_Content):
    pass


class LlmChat:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    def with_model(self, *args, **kwargs):
        return self

    def with_system_message(self, *args, **kwargs):
        return self

    async def send_message(self, *args, **kwargs):
        raise RuntimeError("emergentintegrations is not installed in this local environment")

