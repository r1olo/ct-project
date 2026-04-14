#include <stdio.h>
#include <stdlib.h>

int64_t miniimp(int64_t);

int main(int argc, char *argv[])
{
    if (argc < 2) {
        fprintf(stderr, "usage: %s <input>\n", argv[0]);
        return 1;
    }

    int64_t out = miniimp(atoll(argv[1]));
    printf("%ld\n", out);
    return 0;
}
