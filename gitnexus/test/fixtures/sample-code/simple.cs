using System;

namespace SampleApp
{
    public class Calculator
    {
        public int Add(int a, int b)
        {
            return a + b;
        }

        private int Multiply(int a, int b)
        {
            return a * b;
        }
    }

    internal class Helper
    {
        public void DoWork() { }
    }
}
