#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

static void *check_allocation(void *unused)
{
    (void)unused;
    const size_t bytes = 2415919120ULL;
    const size_t offsets[] = {0, bytes / 2, bytes - 1};
    const unsigned char values[] = {23, 117, 231};
    volatile unsigned char *allocation = calloc(1, bytes);
    int passed = allocation != NULL;
    if (allocation != NULL) {
        for (size_t index = 0; index < 3; index += 1) {
            passed = passed && allocation[offsets[index]] == 0;
            allocation[offsets[index]] = values[index];
        }
        for (size_t index = 0; index < 3; index += 1) {
            passed = passed && allocation[offsets[index]] == values[index];
        }
        free((void *)allocation);
    }
    printf("{\"allocator\":\"dlmalloc\",\"bytes\":%zu,\"passed\":%s,"
           "\"threaded\":true,\"touch\":\"first-middle-last sentinels\"}\n",
           bytes, passed ? "true" : "false");
    return (void *)(uintptr_t)(passed ? 0 : 1);
}

int main(void)
{
    pthread_t thread;
    void *result = NULL;
    if (pthread_create(&thread, NULL, check_allocation, NULL) != 0) {
        return 2;
    }
    if (pthread_join(thread, &result) != 0) {
        return 3;
    }
    return (int)(uintptr_t)result;
}
